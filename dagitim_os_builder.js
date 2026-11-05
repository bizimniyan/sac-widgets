(function () {
    const FIELDS = [
        { id: "providerId", label: "Model ProviderID", rows: 1 },
        { id: "rowDims", label: "Satırlar (virgülle; ID:Başlık; özellik BOYUT.ÖZELLİK)", hint: "ZMASRAF_YERI:Gönderen Masrafyeri, ZMASRAF_YERIALICI:Alıcı Masraf Yeri", rows: 2 },
        { id: "colDims", label: "Sütunlar (KOMBO = 5 sabit parametre/veri kaynağı kolonu; virgülle; ID:Başlık)", hint: "Date, KOMBO", rows: 2 },
        { id: "filters", label: "Filtreler (BOYUT=değer,değer ; ile ayrılır; Version ve şirket kodu script ile)", hint: "ZPARAMETRE=DGT0002,DGT0003; ZDATA_SOURCE=CALC,PREDGTM", rows: 4 },
        { id: "measures", label: "Measure (virgülle; ID:Başlık)", hint: "ZMIKTAR:Miktar", rows: 1 },
        { id: "measureSelect", label: "Measure seçimli (x = ekranda ZTUTAR / _TRY / _EUR / _USD seçimi)", hint: "x", rows: 1 },
        { id: "freezeCols", label: "Donuk kolon sayısı (soldan, tanım kolonları dahil; boş = ilk boyut)", hint: "5", rows: 1 }
    ];

    const template = document.createElement("template");
    template.innerHTML = `
        <style>
            .form { font: 13px Arial, sans-serif; padding: 8px; }
            .form label { display: block; margin: 8px 0 3px; font-weight: bold; }
            .form textarea { width: 100%; box-sizing: border-box; padding: 5px; font: 12px Arial, sans-serif; resize: vertical; }
            .form button { margin-top: 10px; padding: 6px 14px; }
        </style>
        <div class="form">
            ${FIELDS.map(f => `<label for="${f.id}">${f.label}</label><textarea id="${f.id}" rows="${f.rows}" placeholder="${f.hint || ""}"></textarea>`).join("")}
            <button id="apply">Uygula</button>
        </div>`;

    class DagitimOncesiSonrasiBuilder extends HTMLElement {
        constructor() {
            super();
            this._shadowRoot = this.attachShadow({ mode: "open" });
            this._shadowRoot.appendChild(template.content.cloneNode(true));
            this._shadowRoot.getElementById("apply").addEventListener("click", () => {
                const properties = {};
                FIELDS.forEach(f => { properties[f.id] = this._shadowRoot.getElementById(f.id).value.trim(); });
                this.dispatchEvent(new CustomEvent("propertiesChanged", { detail: { properties } }));
            });
        }

        onCustomWidgetAfterUpdate(changedProps) {
            FIELDS.forEach(f => {
                if (f.id in changedProps) {
                    this._shadowRoot.getElementById(f.id).value = changedProps[f.id] === undefined ? "" : changedProps[f.id];
                }
            });
        }
    }

    customElements.define("custom-dagitim-os-builder", DagitimOncesiSonrasiBuilder);
})();
