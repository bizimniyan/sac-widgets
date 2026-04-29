(function() {
    const loadScript = (src) => new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });

    let template = document.createElement("template");
    template.innerHTML = `
        <link href="https://unpkg.com/tabulator-tables@5.5.0/dist/css/tabulator.min.css" rel="stylesheet">
        <style>
            :host {
                display: block;
                width: 100%;
                height: 100%;
                background-color: #fff;
            }
            #example-table {
                width: 100%;
                height: 100%;
                font-size: 14px;
            }
            /* Tabulator için kurumsal renk düzenlemeleri */
            .tabulator {
                border: 1px solid #e0e0e0 !important;
                background-color: #fff;
            }
            .tabulator-header {
                background-color: #f4f6f9 !important;
                color: #333;
                font-weight: 600;
                border-bottom: 2px solid #ddd !important;
            }
            .tabulator-row {
                border-bottom: 1px solid #eee;
            }
            .tabulator-row:nth-child(even) {
                background-color: #fafafa;
            }
            .tabulator-row:hover {
                background-color: #f0f4f8 !important;
            }
            .tabulator-row.tabulator-tree-level-0 {
                font-weight: bold;
                background-color: #fdfdfd;
            }
        </style>
        <div id="example-table"></div>
    `;

    class HierarchicalTable extends HTMLElement {
        constructor() {
            super();
            let shadowRoot = this.attachShadow({mode: "open"});
            shadowRoot.appendChild(template.content.cloneNode(true));
            this._container = shadowRoot.getElementById("example-table");
            this.table = null;
        }

        async onCustomWidgetAfterUpdate(changedProperties) {
            if ("myDataSource" in changedProperties) {
                await this.initTabulator();
                this.renderData();
            }
        }

        async initTabulator() {
            if (window.Tabulator) return;
            this._container.innerHTML = "<div style='padding:10px;'>Tabulator Grid Kütüphanesi Yükleniyor...</div>";
            try {
                await loadScript("https://unpkg.com/tabulator-tables@5.5.0/dist/js/tabulator.min.js");
            } catch (e) {
                this._container.innerHTML = "<div style='padding:10px; color:red;'>Kütüphane yüklenemedi. İnternet bağlantınızı kontrol edin.</div>";
            }
        }

        renderData() {
            if (!window.Tabulator) return;

            if (!this.myDataSource || this.myDataSource.state !== "success") {
                this._container.innerHTML = "<div style='padding:10px;'>Veri bekleniyor...</div>";
                return;
            }

            const data = this.myDataSource.data;
            if (!data || data.length === 0) {
                this._container.innerHTML = "<div style='padding:10px;'>Veri bulunamadı. Lütfen Builder panelinden boyut ve ölçüm ekleyin.</div>";
                return;
            }

            const metadata = this.myDataSource.metadata;

            const dimKeys = metadata.feeds.dimensions?.values || [];
            const measureKeys = metadata.feeds.measures?.values || [];

            if (dimKeys.length < 2) {
                this._container.innerHTML = "<div style='padding:10px; color:red;'>Hata: Lütfen satırlara en az 2 boyut ekleyin (Örn: 1. Mamül, 2. Bileşen).</div>";
                return;
            }

            const parentDimKey = dimKeys[0];
            const childDimKey = dimKeys[1];

            // 1. VERİYİ AĞAÇ YAPISINA ÇEVİRME
            const parentMap = new Map();
            const allChildren = new Set();
            const allParents = new Set();

            data.forEach(row => {
                let pId = row[parentDimKey]?.id || "";
                let pLabel = row[parentDimKey]?.label || pId;
                
                let cId = row[childDimKey]?.id || "";
                let cLabel = row[childDimKey]?.label || cId;

                if (!pId || !cId) return;

                if (!parentMap.has(pId)) {
                    parentMap.set(pId, { label: pLabel, children: [] });
                }
                
                allParents.add(pId);
                allChildren.add(cId);

                parentMap.get(pId).children.push({
                    id: cId,
                    label: cLabel,
                    row: row
                });
            });

            // "Kök" (Root) düğümleri bul
            const roots = [];
            for (const pId of allParents) {
                if (!allChildren.has(pId)) {
                    roots.push(pId);
                }
            }

            // Recursive Tree Data Builder for Tabulator
            const buildTreeNode = (nodeId, rowData) => {
                const nodeObj = parentMap.get(nodeId);
                let item = { 
                    id: Math.random().toString(36).substr(2, 9), // Tabulator benzersiz ID ister
                    name: nodeObj ? nodeObj.label : (rowData ? rowData[childDimKey]?.label : nodeId)
                };
                
                // Ölçümleri (Measures) Ekle
                if (rowData) {
                    measureKeys.forEach(mKey => {
                        item[mKey] = rowData[mKey]?.raw || 0;
                    });
                } else {
                    // Verisi olmayan Kök düğümler için başlangıçta 0 ata
                    measureKeys.forEach(mKey => item[mKey] = 0);
                }
                
                // Alt bileşenleri varsa _children dizisine ekle
                if (nodeObj && nodeObj.children.length > 0) {
                    item._children = [];
                    nodeObj.children.forEach(child => {
                        item._children.push(buildTreeNode(child.id, child.row));
                    });
                    
                    // Alt birimlerin toplamını ana düğüme yansıt (Roll-up Aggregation)
                    // Eğer ana düğümün kendi değeri yoksa (Kök ise), altlardan gelenleri topla
                    if (!rowData) {
                        measureKeys.forEach(mKey => {
                            let sum = 0;
                            item._children.forEach(c => sum += (c[mKey] || 0));
                            item[mKey] = sum;
                        });
                    }
                }
                
                return item;
            };

            const tableData = [];
            roots.forEach(rId => {
                tableData.push(buildTreeNode(rId, null));
            });

            // 2. DİNAMİK KOLONLARI OLUŞTUR
            const columns = [
                { title: "Mamül / Bileşen", field: "name", width: 300, responsive: 0 }
            ];
            
            measureKeys.forEach(mKey => {
                let mLabel = metadata.mainStructureMembers?.[mKey]?.label || mKey;
                columns.push({ 
                    title: mLabel, 
                    field: mKey, 
                    hozAlign: "right",
                    formatter: "money", 
                    formatterParams: { precision: 2, decimal: ",", thousand: "." }
                });
            });

            // 3. TABULATOR GRID'İ BAŞLAT
            if (this.table) {
                this.table.destroy();
            }

            // İçeriği temizle
            this._container.innerHTML = "";

            this.table = new window.Tabulator(this._container, {
                data: tableData,
                layout: "fitColumns",
                dataTree: true,
                dataTreeStartExpanded: false, // Sadece kökler görünsün, açtıkça gelsin
                dataTreeChildIndent: 25,      // Hiyerarşi girinti boyutu
                columns: columns,
                height: "100%",               // Virtual Scrolling için yüksekliğin set edilmesi şart
                virtualDom: true,             // 100k+ satır için sihirli dokunuş
                rowFormatter: function(row){
                    // Seçime bağlı satır tasarımı
                }
            });
        }
    }

    customElements.define("custom-hierarchical-table", HierarchicalTable);
})();
