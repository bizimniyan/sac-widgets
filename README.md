# SAC Yüksek Hacimli Hiyerarşik Tablo (BOM) Widget'ı

Bu proje, SAP Analytics Cloud (SAC) üzerinde milyonlarca satırlık devasa hacimli Ürün Ağacı (BOM) verilerini donma olmadan, hiyerarşik (Tree Data) yapıda gösterebilmek için tasarlanmış bir Özel Pencere Öğesidir (Custom Widget).

## Özellikler
- **Virtual Scrolling (Sanal Kaydırma):** `Tabulator` kütüphanesi entegrasyonu sayesinde sadece ekranda görünen satırlar HTML olarak çizilir. Çok yüksek veri hacimlerinde bile tarayıcıyı dondurmaz.
- **Sonsuz Hiyerarşi (N-Level Tree Data):** Verinizdeki Ebeveyn-Çocuk (Mamül-Bileşen) ilişkisini otomatik olarak analiz eder ve sonsuz derinlikte iç içe açılır bir ağaç çizer.
- **Dinamik Sütunlar:** SAC Builder panelinden eklenen ölçüm ve boyutları otomatik olarak okur ve tablo sütunlarına dönüştürür.
- **Grup Toplamları (Roll-up Aggregation):** Alt kırılımlardaki (Örn: Hammadde) sayısal değerleri otomatik toplayarak (Top-down) üst kırılımlara (Yarı Mamül ve Kök Mamül) hesaplayıp yansıtır.

## Kurulum ve Kullanım
1. `hierarchical_table.json` dosyasını SAC ortamınızdaki Custom Widgets menüsünden sisteme yükleyin.
2. `hierarchical_table.js` dosyasını kullanacağınız bir sunucuya atın ve JSON içerisindeki URL yolunu ("url": "...") kendi yolunuza göre düzeltin.
3. SAC Analitik uygulamasına girip widget'ı ekrana sürükleyin.
4. Builder Panelinden:
   - **Satırlar (Dimensions):** Sırasıyla 1. Mamül Boyutu, 2. Bileşen Boyutu olacak şekilde **tam olarak 2 boyut** ekleyin.
   - **Sütunlar (Measures):** Göstermek istediğiniz sayısal hesaplamaları (Örn: Dönemler, Miktarlar vb.) ekleyin.

## Test Simülasyonları
Geliştirme klasöründe algoritmayı test edebilmeniz için iki adet yerel dosya mevcuttur:
- **`test_ekrani.html`**: Hiyerarşik görselleştirmenin basit testidir.
- **`test_tabulator.html`**: Arka planda 50.000 satırlık sanal bir ürün ağacı oluşturup, Tabulator kütüphanesinin sanal kaydırma (virtual scrolling) performansını test edebilmenizi sağlar. Çift tıklayıp açmanız yeterlidir.
