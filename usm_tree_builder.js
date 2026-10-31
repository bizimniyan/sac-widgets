(function () {
    const FIELDS = [
        { id: "providerId", label: "Model ProviderID" },
        { id: "version", label: "Versiyon (örn. public.2027BUD_01)" },
        { id: "parameters", label: "Parametreler (virgülle)" },
        { id: "pageSize", label: "Blok boyutu (malzeme)" }
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
            <label><input id="onlyParents" type="checkbox" style="width:auto"> Sadece bileşeni/aktivitesi olan malzemeler</label>
            <button id="apply">Uygula</button>
        </div>`;

    class UsmTreeBuilder extends HTMLElement {
        constructor() {
            super();
            this._shadowRoot = this.attachShadow({ mode: "open" });
            this._shadowRoot.appendChild(template.content.cloneNode(true));
            this._shadowRoot.getElementById("apply").addEventListener("click", () => {
                const val = (id) => this._shadowRoot.getElementById(id).value.trim();
                this.dispatchEvent(new CustomEvent("propertiesChanged", {
                    detail: {
                        properties: {
                            providerId: val("providerId"),
                            version: val("version"),
                            parameters: val("parameters"),
                            pageSize: parseInt(val("pageSize"), 10) || 200,
                            onlyParents: this._shadowRoot.getElementById("onlyParents").checked
                        }
                    }
                }));
            });
        }

        onCustomWidgetAfterUpdate(changedProps) {
            FIELDS.forEach(f => {
                if (f.id in changedProps) {
                    this._shadowRoot.getElementById(f.id).value = changedProps[f.id] === undefined ? "" : changedProps[f.id];
                }
            });
            if ("onlyParents" in changedProps) {
                this._shadowRoot.getElementById("onlyParents").checked = changedProps.onlyParents !== false;
            }
        }
    }

    customElements.define("custom-usm-tree-builder", UsmTreeBuilder);
})();
