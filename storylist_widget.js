(function () {
    let template = document.createElement("template");
    template.innerHTML = `
        <style>
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            .wrap { font-family: "72", Arial, sans-serif; height: 100%; box-sizing: border-box; padding: 12px; overflow: auto; color: #1a1a1a; }
            .title { font-size: 16px; font-weight: 700; margin: 0 0 10px 0; }
            ul { list-style: none; margin: 0; padding: 0; }
            li { padding: 8px 6px; border-bottom: 1px solid #eee; }
            li:hover { background: #f5f7fa; }
            a { color: #0a6ed1; text-decoration: none; font-size: 14px; cursor: pointer; word-break: break-word; }
            a:hover { text-decoration: underline; }
            .meta { color: #888; font-size: 11px; margin-top: 2px; }
            .state { color: #888; font-size: 13px; padding: 8px 0; }
            .error { color: #bb0000; font-size: 13px; padding: 8px 0; white-space: pre-wrap; }
        </style>
        <div class="wrap">
            <h3 class="title" id="title"></h3>
            <div id="content"><div class="state">Yükleniyor…</div></div>
        </div>
    `;

    class StoryList extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({ mode: "open" });
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._titleEl = shadowRoot.getElementById("title");
            this._contentEl = shadowRoot.getElementById("content");
        }

        onCustomWidgetAfterUpdate(changedProperties) {
            if ("title" in changedProperties || "repositoryUrl" in changedProperties) {
                this.render();
            }
        }

        // SAC scripting: StoryList_1.refresh()
        refresh() {
            this.render();
        }

        async render() {
            // Baslik
            this._titleEl.textContent = this.title || "";
            this._titleEl.style.display = this.title ? "block" : "none";

            const url = (this.repositoryUrl || "").trim();
            if (!url) {
                this._contentEl.innerHTML = '<div class="state">Builder panelinden API URL girin.</div>';
                return;
            }
            this._contentEl.innerHTML = '<div class="state">Yükleniyor…</div>';

            try {
                const resp = await fetch(url, {
                    method: "GET",
                    credentials: "include",
                    headers: { Accept: "application/json" }
                });
                if (!resp.ok) {
                    throw new Error("HTTP " + resp.status + " " + resp.statusText);
                }
                const data = await resp.json();
                const items = Array.isArray(data && data.value) ? data.value : [];
                const stories = items.filter(function (it) {
                    return it && it.resourceType === "STORY";
                });
                this.renderList(stories, url);
            } catch (e) {
                this._contentEl.innerHTML =
                    '<div class="error">Yüklenemedi:\n' +
                    String(e && e.message ? e.message : e) + "</div>";
            }
        }

        renderList(stories, sourceUrl) {
            if (!stories.length) {
                this._contentEl.innerHTML = '<div class="state">Bu klasörde story bulunamadı.</div>';
                return;
            }

            // openURL göreli path -> kaynak URL'in origin'i ile tam URL'e cevir
            let origin = "";
            try {
                origin = new URL(sourceUrl, window.location.href).origin;
            } catch (e) {
                origin = window.location.origin;
            }

            const ul = document.createElement("ul");
            stories.forEach(function (s) {
                const li = document.createElement("li");
                const a = document.createElement("a");

                let href = s.openURL || "";
                if (href && !/^https?:\/\//i.test(href)) {
                    href = origin + (href.charAt(0) === "/" ? "" : "/") + href;
                }

                a.textContent = s.name || s.objectId || s.resourceId || "(adsız)";
                a.href = href;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                li.appendChild(a);

                if (s.modifiedBy || s.modifiedTime) {
                    const meta = document.createElement("div");
                    meta.className = "meta";
                    const when = s.modifiedTime ? new Date(s.modifiedTime).toLocaleString() : "";
                    meta.textContent = (s.modifiedBy ? s.modifiedBy : "") + (when ? " · " + when : "");
                    li.appendChild(meta);
                }
                ul.appendChild(li);
            });

            this._contentEl.innerHTML = "";
            this._contentEl.appendChild(ul);
        }
    }

    customElements.define("custom-story-list", StoryList);
})();
