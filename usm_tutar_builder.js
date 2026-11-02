(function () {
    const FIELDS = [
        { id: "providerId", label: "Model ProviderID" },
        { id: "version", label: "Versiyon (örn. public.2027BUD_01)" },
        { id: "companyCode", label: "Şirket kodu (boş = hepsi, virgülle çoklu)" },
        { id: "parameters", label: "Parametreler (virgülle, kolon sırası)" },
        { id: "measure", label: "Varsayılan measure (ZTUTAR_TRY, ZTUTAR_EUR, ZTUTAR_USD)" }
    ];

    const template = document.createElement("template");
    template.innerHTML = `
        <style>
            .form { font: 13px Arial, sans-serif; padding: 8px; }
            .form label { display: block; margin: 8px 0 3px; font-weight: bold; }
            .form input { width: 100%; box-sizing: border-box; padding: 5px; }
            .form button { margin-top: 10px; padding: 6px 14px; }
        </style>
        <div class="form">
            ${FIELDS.map(f => `<label for="${f.id}">${f.label}</label><input id="${f.id}" type="text">`).join("")}
            <button id="apply">Uygula</button>
        </div>`;

    class UsmTutarBuilder extends HTMLElement {
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

    customElements.define("custom-usm-tutar-builder", UsmTutarBuilder);
})();
