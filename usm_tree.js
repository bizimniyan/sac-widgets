(function () {
    const TABULATOR_JS = "https://unpkg.com/tabulator-tables@5.5.0/dist/js/tabulator.min.js";
    const NONE = "#";
    const CHILD_FILTER = " and (ZBILESEN ne '#' or ZMASRAF_OGESI ne '#')";
    const CHUNK = 40;
    const TYPE_LABEL = { M: "Malzeme", B: "Bileşen", A: "Aktivite" };

    const loadScript = (src) => new Promise((resolve, reject) => {
        if (window.Tabulator) return resolve();
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Tabulator yüklenemedi"));
        document.head.appendChild(script);
    });

    const q = (v) => String(v).replace(/'/g, "''");
    const orEq = (field, ids) => "(" + ids.map(id => `${field} eq '${q(id)}'`).join(" or ") + ")";
    const chunks = (arr, n) => {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    };
    const fieldOf = (date, param) => `v${date}_${param}`;
    const fmtDate = (d) => /^\d{6}$/.test(d) ? `${d.slice(4)}.${d.slice(0, 4)}` : d;
    const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
    const numFormatter = (cell) => {
        const v = cell.getValue();
        return v === undefined || v === null ? "" : nf.format(v);
    };
    const addValue = (target, r) => {
        if (r.ZMIKTAR === null || r.ZMIKTAR === undefined) return;
        const f = fieldOf(r.Date, r.ZPARAMETRE);
        target[f] = (target[f] || 0) + r.ZMIKTAR;
    };
    const errText = (e) => e && e.message ? e.message : String(e);

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@5.5.0/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { display: flex; flex-direction: column; width: 100%; height: 100%; font-family: "72", Arial, sans-serif; }
            #status { flex: 0 0 auto; font-size: 12px; color: #666; padding: 4px 8px; }
            #status.error { color: #bb0000; white-space: pre-wrap; }
            #table { flex: 1 1 auto; min-height: 0; font-size: 13px; }
            .tabulator { border: 1px solid #e0e0e0 !important; background-color: #fff; }
            .tabulator-header { background-color: #f4f6f9 !important; color: #333; font-weight: 600; border-bottom: 2px solid #ddd !important; }
            .tabulator-row { border-bottom: 1px solid #eee; }
            .tabulator-row:hover { background-color: #f0f4f8 !important; }
            .tabulator-row.tabulator-tree-level-0 { font-weight: bold; }
            .tabulator-row.row-activity { color: #555; font-style: italic; }
            .tabulator-row.row-placeholder { color: #999; }
        </style>
        <div class="wrap">
            <div id="status">Yükleniyor…</div>
            <div id="table"></div>
        </div>
    `;

    class UsmTree extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._statusEl = shadowRoot.getElementById("status");
            this._tableEl = shadowRoot.getElementById("table");
            this._table = null;
            this._token = 0;
            this._desc = { ZMALZEME: new Map(), ZBILESEN: new Map(), ZMASRAF_OGESI: new Map() };
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if (["providerId", "version", "parameters", "pageSize", "onlyParents"].some(k => k in changedProperties)) {
                this.refresh();
            }
        }

        onCustomWidgetResize() {
            if (this._table) this._table.redraw();
        }

        async refresh() {
            const token = ++this._token;
            this._blocks = new Map();
            this._ids = [];
            this._parentSet = new Set();
            this._childCache = new Map();
            this._failed = false;

            this._pid = (this.providerId || "").trim();
            let version = (this.version || "").trim();
            if (version && version.indexOf(".") < 0) version = "public." + version;
            this._params = (this.parameters || "").split(",").map(s => s.trim()).filter(Boolean);
            this._blockSize = this.pageSize > 0 ? this.pageSize : 200;
            this._onlyParents = this.onlyParents !== false;

            if (!this._pid || !version || !this._params.length) {
                this._setStatus("Builder panelinden model, versiyon ve parametreleri girin.");
                return;
            }
            this._baseFilter = `Version eq '${q(version)}' and ${orEq("ZPARAMETRE", this._params)}`;
            this._setStatus("Malzeme listesi yükleniyor…");

            try {
                await loadScript(TABULATOR_JS);
                const [dateRows, idRows, parentRows] = await Promise.all([
                    this._get("FactDataAggregation", { $select: "Date,ZMIKTAR", $filter: this._baseFilter, $orderby: "Date" }),
                    this._get("FactDataAggregation", {
                        $select: "ZMALZEME,ZMIKTAR",
                        $filter: this._baseFilter + (this._onlyParents ? CHILD_FILTER : ""),
                        $orderby: "ZMALZEME"
                    }),
                    this._onlyParents ? null : this._get("FactDataAggregation", { $select: "ZMALZEME,ZMIKTAR", $filter: this._baseFilter + CHILD_FILTER })
                ]);
                if (token !== this._token) return;
                const dates = dateRows.map(r => r.Date).filter(d => d && d !== NONE);
                this._ids = idRows.map(r => r.ZMALZEME).filter(id => id && id !== NONE);
                if (!dates.length || !this._ids.length) {
                    this._destroyTable();
                    this._setStatus(`${version} versiyonunda bu parametrelerle veri yok.`);
                    return;
                }
                this._parentSet = new Set(parentRows ? parentRows.map(r => r.ZMALZEME) : this._ids);
                const rows = this._ids.map((id, pos) =>
                    Object.assign(this._row(`M${id}`, "M", id, "ZMALZEME", this._parentSet.has(id)), { _pos: pos }));
                this._buildTable(dates, rows);
                this._loadAllActivityDescriptions();
            } catch (e) {
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        _setStatus(text, isError) {
            this._statusEl.textContent = text;
            this._statusEl.className = isError ? "error" : "";
        }

        _updateStatus() {
            if (this._failed) return;
            const busy = Array.from(this._blocks.values()).some(s => s === "busy");
            this._setStatus(`${nf.format(this._ids.length)} malzeme${busy ? " · değerler yükleniyor…" : ""}`);
        }

        _destroyTable() {
            if (this._table) {
                this._table.destroy();
                this._table = null;
            }
            this._tableEl.innerHTML = "";
        }

        async _get(path, params) {
            const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
            let url = `${window.location.origin}/api/v1/dataexport/providers/sac/${encodeURIComponent(this._pid)}/${path}?${qs}`;
            const out = [];
            while (url) {
                const resp = await fetch(url, { method: "GET", credentials: "include", headers: { Accept: "application/json" } });
                if (!resp.ok) {
                    const body = await resp.text();
                    throw new Error(`HTTP ${resp.status} ${body.slice(0, 300)}`);
                }
                const data = await resp.json();
                const rows = Array.isArray(data) ? data : (data.value || []);
                rows.forEach(r => out.push(r));
                url = Array.isArray(data) ? null : (data["@odata.nextLink"] || null);
            }
            return out;
        }

        async _loadDescriptions(dim, ids) {
            const cache = this._desc[dim];
            const missing = ids.filter(id => !cache.has(id));
            await Promise.all(chunks(missing, CHUNK).map(async (part) => {
                const rows = await this._get(`${dim}Master`, { $select: "ID,Description", $filter: orEq("ID", part) });
                part.forEach(id => cache.set(id, ""));
                rows.forEach(r => cache.set(r.ID, r.Description || ""));
            }));
        }

        async _loadAllActivityDescriptions() {
            try {
                const rows = await this._get("ZMASRAF_OGESIMaster", { $select: "ID,Description" });
                rows.forEach(r => this._desc.ZMASRAF_OGESI.set(r.ID, r.Description || ""));
            } catch (e) {
                return;
            }
        }

        _childData(id) {
            if (!this._childCache.has(id)) {
                const p = this._get("FactDataAggregation", {
                    $select: "Date,ZPARAMETRE,ZBILESEN,ZMASRAF_OGESI,ZMIKTAR",
                    $filter: `${this._baseFilter} and ZMALZEME eq '${q(id)}'${CHILD_FILTER}`
                }).then(recs => {
                    const comps = new Map();
                    const acts = new Map();
                    recs.forEach(r => {
                        let map, cid;
                        if (r.ZBILESEN && r.ZBILESEN !== NONE) { map = comps; cid = r.ZBILESEN; }
                        else if (r.ZMASRAF_OGESI && r.ZMASRAF_OGESI !== NONE) { map = acts; cid = r.ZMASRAF_OGESI; }
                        else return;
                        if (!map.has(cid)) map.set(cid, {});
                        addValue(map.get(cid), r);
                    });
                    return { comps, acts };
                });
                p.catch(() => this._childCache.delete(id));
                this._childCache.set(id, p);
            }
            return this._childCache.get(id);
        }

        _prefetch(row) {
            const d = row.getData();
            if (d._kind === "P" || d._kind === "A" || d._loaded || !Array.isArray(d._children)) return;
            this._childData(d._id);
        }

        _row(key, type, id, dim, expandable) {
            const row = { key, type: TYPE_LABEL[type], name: id, desc: this._desc[dim].get(id) || "", _id: id, _kind: type };
            if (expandable) row._children = [{ key: key + "/…", name: "Yükleniyor…", _kind: "P" }];
            return row;
        }

        _buildTable(dates, rows) {
            this._destroyTable();
            const columns = [
                { title: "Kod", field: "name", width: 190, frozen: true },
                { title: "Açıklama", field: "desc", width: 280, frozen: true },
                { title: "Tür", field: "type", width: 80, frozen: true }
            ];
            dates.forEach(d => {
                columns.push({
                    title: fmtDate(d),
                    columns: this._params.map(p => ({
                        title: p, field: fieldOf(d, p), width: 95, hozAlign: "right", formatter: numFormatter
                    }))
                });
            });

            this._table = new window.Tabulator(this._tableEl, {
                index: "key",
                data: rows,
                height: "100%",
                rowHeight: 26,
                layout: "fitData",
                columns: columns,
                columnDefaults: { headerSort: false },
                dataTree: true,
                dataTreeStartExpanded: false,
                dataTreeChildIndent: 22,
                dataTreeElementColumn: "name",
                placeholder: "",
                rowFormatter: (row) => {
                    const k = row.getData()._kind;
                    if (k === "A") row.getElement().classList.add("row-activity");
                    if (k === "P") row.getElement().classList.add("row-placeholder");
                }
            });
            this._table.on("tableBuilt", () => this._loadVisible());
            this._table.on("scrollVertical", () => {
                if (this._scrollTimer) return;
                this._scrollTimer = setTimeout(() => {
                    this._scrollTimer = null;
                    this._loadVisible();
                }, 100);
            });
            this._table.on("dataTreeRowExpanded", (row) => this._expand(row));
            this._table.on("rowMouseEnter", (e, row) => {
                clearTimeout(this._hoverTimer);
                this._hoverTimer = setTimeout(() => this._prefetch(row), 150);
            });
            this._table.on("rowMouseLeave", () => clearTimeout(this._hoverTimer));
            this._updateStatus();
        }

        _loadVisible() {
            if (!this._table || !this._table.initialized || this._failed) return;
            const pos = this._table.getRows("visible").map(r => r.getData()._pos).filter(p => p !== undefined);
            if (!pos.length) return;
            const first = Math.floor(Math.min.apply(null, pos) / this._blockSize);
            const last = Math.floor(Math.max.apply(null, pos) / this._blockSize);
            for (let b = Math.max(0, first - 1); b <= last + 1; b++) this._loadBlock(b);
        }

        async _loadBlock(b) {
            const start = b * this._blockSize;
            if (start >= this._ids.length || this._blocks.has(b)) return;
            this._blocks.set(b, "busy");
            this._updateStatus();
            const token = this._token;
            const ids = this._ids.slice(start, start + this._blockSize);
            const range = ` and ZMALZEME ge '${q(ids[0])}' and ZMALZEME le '${q(ids[ids.length - 1])}'`;
            try {
                const [vals] = await Promise.all([
                    this._get("FactDataAggregation", { $select: "ZMALZEME,Date,ZPARAMETRE,ZMIKTAR", $filter: this._baseFilter + range }),
                    this._loadDescriptions("ZMALZEME", ids)
                ]);
                if (token !== this._token) return;
                const updates = new Map(ids.map(id => [id, { key: `M${id}`, desc: this._desc.ZMALZEME.get(id) || "" }]));
                vals.forEach(r => { if (updates.has(r.ZMALZEME)) addValue(updates.get(r.ZMALZEME), r); });
                await this._table.updateData(Array.from(updates.values()));
                this._blocks.set(b, "done");
                this._updateStatus();
            } catch (e) {
                if (token !== this._token) return;
                this._blocks.delete(b);
                this._failed = true;
                this._setStatus("Yüklenemedi: " + errText(e), true);
            }
        }

        async _expand(row) {
            const d = row.getData();
            if (d._kind === "P" || d._loaded || d._busy) return;
            d._busy = true;
            const token = this._token;
            try {
                const { comps, acts } = await this._childData(d._id);
                if (token !== this._token) return;
                const compIds = Array.from(comps.keys()).sort();
                const actIds = Array.from(acts.keys()).sort();
                const children = [];
                compIds.forEach(id => children.push(Object.assign(this._row(`${d.key}/B${id}`, "B", id, "ZBILESEN", this._parentSet.has(id)), comps.get(id))));
                actIds.forEach(id => children.push(Object.assign(this._row(`${d.key}/A${id}`, "A", id, "ZMASRAF_OGESI", false), acts.get(id))));
                await row.update({ _children: children.length ? children : null, _loaded: true, _busy: false });

                await Promise.all([
                    this._loadDescriptions("ZBILESEN", compIds),
                    this._loadDescriptions("ZMASRAF_OGESI", actIds)
                ]);
                if (token !== this._token) return;
                row.getTreeChildren().forEach(c => {
                    const cd = c.getData();
                    const dim = cd._kind === "B" ? "ZBILESEN" : cd._kind === "A" ? "ZMASRAF_OGESI" : null;
                    const desc = dim ? this._desc[dim].get(cd._id) || "" : "";
                    if (dim && desc !== cd.desc) c.update({ desc });
                });
            } catch (e) {
                d._busy = false;
                if (token !== this._token) return;
                await row.update({ _children: [{ key: d.key + "/!", name: "Hata: " + errText(e), _kind: "P" }] });
            }
        }
    }

    customElements.define("custom-usm-tree", UsmTree);
})();
