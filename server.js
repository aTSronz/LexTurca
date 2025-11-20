 const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require('multer');
const pdf = require('pdf-extraction');
const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } = require("docx");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// --- AYARLAR ---
app.use(cors());
app.use(express.json());
// 'public' klasöründeki dosyaları (CSS, Resimler) dışarı açıyoruz
app.use(express.static('public')); 

// --- YAPAY ZEKA BAĞLANTISI ---
const MODEL_NAME = "gemini-2.0-flash"; 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

console.log("------------------------------------------------");
console.log(`✅ LexTurca Sunucusu Hazır`);
console.log(`✅ Mod: Business (Satış + Uygulama)`);
console.log(`✅ AI Modeli: ${MODEL_NAME}`);
console.log("------------------------------------------------");

// --- HAKİM VERİTABANI YÜKLEME ---
let hakimVeritabani = [];
try {
    const data = fs.readFileSync('hakimler.json', 'utf8');
    hakimVeritabani = JSON.parse(data);
} catch (e) {
    console.log("⚠️ Bilgi: 'hakimler.json' bulunamadı, sadece AI kullanılacak.");
}

// ============================================================
// API UÇ NOKTALARI (FONKSİYONLAR)
// ============================================================

// 1. HAYALET YAZAR (Dilekçe Yazar)
app.post('/api/yazar', async (req, res) => {
    try {
        const { konu, ton } = req.body;
        const prompt = `Sen tecrübeli bir Türk avukatısın. Konu: ${konu}, Ton: ${ton}. 
        Profesyonel, hukuki terimler içeren (arz ederim, davalı, müvekkil vb.) bir dilekçe taslağı yaz.`;
        
        const result = await model.generateContent(prompt);
        res.json({ text: result.response.text() });
    } catch (e) {
        console.error("Yazar Hatası:", e);
        res.status(500).json({ error: "AI yanıt vermedi." });
    }
});

// 2. ÇELİŞKİ AVCISI (PDF Okur ve Analiz Eder)
app.post('/api/celiski-avcisi', upload.single('dosya'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Dosya yüklenmedi." });
        
        console.log(`📂 Dosya Analizi: ${req.file.originalname}`);
        
        // PDF'i Metne Çevir
        const data = await pdf(req.file.buffer);
        const pdfText = data.text;

        if (!pdfText || pdfText.length < 10) {
            return res.json({ result: "⚠️ Bu dosyadan metin okunamadı. (Resim/Taranmış belge olabilir)." });
        }
        
        // Token limiti için metni kırp
        const cleanText = pdfText.substring(0, 25000);

        const prompt = `Sen 35 yıllık ceza avukatısın. Aşağıdaki metni analiz et.
        Tarihler, saatler, olay akışı veya şahıs ifadeleri arasındaki ÇELİŞKİLERİ ve MANTIK HATALARINI bul.
        
        Çıktı Formatı:
        - 🔴 **Kritik Çelişki:** ...
        - 🟠 **Dikkat:** ...
        
        METİN: ${cleanText}`;

        const result = await model.generateContent(prompt);
        res.json({ result: result.response.text() });

    } catch (e) {
        console.error("PDF Hatası:", e);
        res.status(500).json({ error: e.message });
    }
});

// 3. HAKİM ANALİTİĞİ (Veritabanı + AI Hibrit)
app.post('/api/hakim-analiz', async (req, res) => {
    try {
        const { hakimAdi } = req.body;
        
        // Önce kendi veritabanımıza bak
        const bulunan = hakimVeritabani.find(h => 
            h.ad.toLowerCase().includes(hakimAdi.toLowerCase()) || 
            h.mahkeme.toLowerCase().includes(hakimAdi.toLowerCase())
        );
        
        if (bulunan) {
            return res.json({ ...bulunan, bulundu: true, kaynak: "SİSTEM KAYDI" });
        }

        // Yoksa Yapay Zekaya sor (Genel Analiz)
        const prompt = `Sen hukuk uzmanısın. Girdi: "${hakimAdi}".
        Bu girdi bir "Mahkeme Türü" mü? (Örn: İş Mahkemesi, Aile Mahkemesi).
        Eğer öyleyse genel eğilim analizi yap. Şahıs ismiyse ve ünlü değilse reddet.
        
        SADECE JSON DÖN:
        { "bulundu": true/false, "ad": "", "egilim": "", "oranlar": [x, y, z], "ipucu": "" }`;
        
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        const data = JSON.parse(text);
        data.kaynak = "AI TAHMİNİ";
        
        res.json(data);

    } catch (e) {
        res.json({ bulundu: false });
    }
});

// 4. MÜVEKKİL İLETİŞİM ASİSTANI
app.post('/api/muvekkil-mesaj', async (req, res) => {
    try {
        const { olay, durum, platform } = req.body;
        const prompt = `Avukat olarak müvekkile ${platform} mesajı yaz. Olay: ${olay}, Durum: ${durum}. Güven verici olsun.`;
        const result = await model.generateContent(prompt);
        res.json({ text: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: "Hata" });
    }
});

// 5. WORD İNDİRME (DOCX Export)
app.post('/api/indir-docx', async (req, res) => {
    try {
        const { baslik, icerik } = req.body;

        const paragraphs = icerik.split('\n').map(line => {
            return new Paragraph({
                children: [new TextRun({ text: line, font: "Times New Roman", size: 24 })],
                spacing: { after: 200 }
            });
        });

        const doc = new Document({
            sections: [{
                properties: {},
                children: [
                    new Paragraph({
                        text: baslik.toUpperCase(),
                        heading: HeadingLevel.HEADING_1,
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 400 }
                    }),
                    ...paragraphs
                ],
            }],
        });

        const buffer = await Packer.toBuffer(doc);
        res.setHeader('Content-Disposition', `attachment; filename=LexTurca_Dilekce.docx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);

    } catch (error) {
        console.error("Word Hatası:", error);
        res.status(500).send("Dosya oluşturulamadı.");
    }
});

// ============================================================
// SAYFA YÖNLENDİRMELERİ (ROUTING)
// ============================================================

// 1. Ana Sayfa'ya (localhost:3000) girenler -> SATIŞ SAYFASINI (index.html) görür
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. Uygulamaya (localhost:3000/app) girenler -> DASHBOARD (app.html) görür
app.get('/app', (req, res) => {
    // Eğer public klasöründe app.html varsa onu aç, yoksa index.html'i aç (Hata olmasın diye)
    const appPath = path.join(__dirname, 'public', 'app.html');
    if (fs.existsSync(appPath)) {
        res.sendFile(appPath);
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Sunucuyu Başlat
app.listen(port, () => {
    console.log(`LexTurca Yayında: http://localhost:${port}`);

}); 
