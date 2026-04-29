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
            :host { display: block; width: 100%; height: 100%; background-color: #fff; }
            #example-table { width: 100%; height: 100%; font-size: 14px; }
            .tabulator { border: 1px solid #e0e0e0 !important; background-color: #fff; }
            .tabulator-header { background-color: #f4f6f9 !important; color: #333; font-weight: 600; border-bottom: 2px solid #ddd !important; }
            .tabulator-row { border-bottom: 1px solid #eee; }
            .tabulator-row:nth-child(even) { background-color: #fafafa; }
            .tabulator-row:hover { background-color: #f0f4f8 !important; }
            .tabulator-row.tabulator-tree-level-0 { font-weight: bold; background-color: #fdfdfd; }
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
            this._container.innerHTML = "<div style='padding:10px;'>Tabulator Grid Yükleniyor...</div>";
            try {
                await loadScript("https://unpkg.com/tabulator-tables@5.5.0/dist/js/tabulator.min.js");
            } catch (e) {
                this._container.innerHTML = "<div style='padding:10px; color:red;'>Kütüphane yüklenemedi.</div>";
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
            const colDimKeys = metadata.feeds.columnDimensions?.values || [];
            const measureKeys = metadata.feeds.measures?.values || [];

            if (dimKeys.length < 2) {
                this._container.innerHTML = "<div style='padding:10px; color:red;'>Hata: Lütfen Satırlara en az 2 boyut ekleyin (Örn: 1. Mamül, 2. Bileşen).</div>";
                return;
            }

            const parentDimKey = dimKeys[0];
            const childDimKey = dimKeys[1];

            // PIVOT: Dinamik Tarih (Sütun) İsimlerini Bul
            const dynamicCols = new Set();
            const usePivot = colDimKeys.length > 0;
            
            data.forEach(row => {
                if (usePivot) {
                    let colVal = row[colDimKeys[0]]?.label || row[colDimKeys[0]]?.id || "Bilinmeyen Dönem";
                    dynamicCols.add(colVal);
                }
            });
            const dynamicColArray = Array.from(dynamicCols);

            // 1. VERİYİ AĞAÇ YAPISINA ÇEVİRME (PIVOT İLE)
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
                    parentMap.set(pId, { label: pLabel, childrenMap: new Map() });
                }
                
                allParents.add(pId);
                allChildren.add(cId);

                let pNode = parentMap.get(pId);
                
                // Alt bileşen aynı ebeveynde farklı tarihler için geldiyse tek objede birleştir (Pivot)
                if (!pNode.childrenMap.has(cId)) {
                    pNode.childrenMap.set(cId, {
                        id: cId,
                        label: cLabel,
                        values: {}
                    });
                }

                let cNode = pNode.childrenMap.get(cId);

                // Ölçümleri Tarih kolonuna yaz
                measureKeys.forEach(mKey => {
                    let val = row[mKey]?.raw || 0;
                    if (usePivot) {
                        let colVal = row[colDimKeys[0]]?.label || row[colDimKeys[0]]?.id || "Bilinmeyen Dönem";
                        let fieldKey = measureKeys.length > 1 ? `${colVal}_${mKey}` : colVal;
                        cNode.values[fieldKey] = (cNode.values[fieldKey] || 0) + val;
                    } else {
                        cNode.values[mKey] = (cNode.values[mKey] || 0) + val;
                    }
                });
            });

            // Map -> Array
            parentMap.forEach(pNode => {
                pNode.children = Array.from(pNode.childrenMap.values());
            });

            const roots = [];
            for (const pId of allParents) {
                if (!allChildren.has(pId)) {
                    roots.push(pId);
                }
            }

            // Hangi matematiksel sütunlar toplanacak?
            let fieldKeysToSum = [];
            if (usePivot) {
                if (measureKeys.length > 1) {
                    dynamicColArray.forEach(colVal => {
                        measureKeys.forEach(mKey => fieldKeysToSum.push(`${colVal}_${mKey}`));
                    });
                } else {
                    fieldKeysToSum = [...dynamicColArray];
                }
            } else {
                fieldKeysToSum = [...measureKeys];
            }

            // Recursive Tree Data Builder
            const buildTreeNode = (nodeId, childValues) => {
                const nodeObj = parentMap.get(nodeId);
                let item = { 
                    id: Math.random().toString(36).substr(2, 9), 
                    name: nodeObj ? nodeObj.label : (childValues ? childValues.label : nodeId)
                };
                
                fieldKeysToSum.forEach(fKey => item[fKey] = 0);
                
                if (childValues) {
                    fieldKeysToSum.forEach(fKey => {
                        item[fKey] = childValues.values[fKey] || 0;
                    });
                }
                
                if (nodeObj && nodeObj.children.length > 0) {
                    item._children = [];
                    nodeObj.children.forEach(child => {
                        item._children.push(buildTreeNode(child.id, child));
                    });
                    
                    // Kökler için aşağıdan yukarıya toplama
                    if (!childValues) {
                        fieldKeysToSum.forEach(fKey => {
                            let sum = 0;
                            item._children.forEach(c => sum += (c[fKey] || 0));
                            item[fKey] = sum;
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
                { title: "Mamül / Bileşen", field: "name", width: 300 }
            ];
            
            if (usePivot) {
                dynamicColArray.forEach(colVal => {
                    if (measureKeys.length > 1) {
                        measureKeys.forEach(mKey => {
                            let mLabel = metadata.mainStructureMembers?.[mKey]?.label || mKey;
                            columns.push({ 
                                title: `${colVal} (${mLabel})`, 
                                field: `${colVal}_${mKey}`, 
                                hozAlign: "right",
                                formatter: "money", 
                                formatterParams: { precision: 2, decimal: ",", thousand: "." }
                            });
                        });
                    } else {
                        // Sadece miktar varsa Sütun adı Direkt Tarih (Ocak, Şubat) olur
                        columns.push({ 
                            title: colVal, 
                            field: colVal, 
                            hozAlign: "right",
                            formatter: "money", 
                            formatterParams: { precision: 2, decimal: ",", thousand: "." }
                        });
                    }
                });
            } else {
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
            }

            // 3. TABULATOR GRID'İ BAŞLAT
            if (this.table) {
                this.table.destroy();
            }

            this._container.innerHTML = "";

            this.table = new window.Tabulator(this._container, {
                data: tableData,
                layout: "fitColumns",
                dataTree: true,
                dataTreeStartExpanded: false,
                dataTreeChildIndent: 25,
                columns: columns,
                height: "100%", 
                virtualDom: true
            });
        }
    }

    customElements.define("custom-hierarchical-table", HierarchicalTable);
})();
