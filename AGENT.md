# OpenSCAD AI - Proje Rehberi (Agent Reference)

> Bu dosya AI agent'larin projeyi hizlica anlamasi icin olusturulmustur.
> Son guncelleme: 2026-04-05

## Genel Bakis
Bu proje, dogal dil promptlarini OpenSCAD koduna ceviren bir Python uygulamasidir. Cekirdek akis promptu AI modele gonderir, uretilen SCAD kodunu OpenSCAD CLI ile dogrular ve yalnizca SCAD ciktisi uretir. Tkinter tabanli masaustu arayuzu vardir. Yeni surumde resmi OpenSCAD dokumanlari (https://openscad.org/documentation.html ve ilgili referans sayfalari) yerel cache'e alinir ve model promptuna baglamsal bilgi olarak enjekte edilir.

## Klasor Yapisi

```text
OpenSCAD AI/
|- prompt_to_openscad.py (~524 satir) - CLI pipeline (AI cagrisi, SCAD dogrulama, SCAD yazma)
|- openscad_docs_context.py (~290 satir) - resmi dokuman sync/cache ve prompta gore context secimi
|- openscad_ai_ui.py (~962 satir) - Tkinter UI, dosya yonetimi, model listesi
|- README.md (~116 satir) - kurulum/kullanim dokumani
|- run-openscad-ai.ps1 (~59 satir) - CLI wrapper
|- run-openscad-ai-ui.ps1 (~8 satir) - UI baslatma wrapper
|- .openscad_ai_ui_config.json (~degisken) - UI provider/model/key ayarlari
|- outputs/ (~degisken) - uretilen .scad dosyalari
|- openscad/ (~buyuk vendor klasoru) - upstream OpenSCAD kaynak kodu ve testleri
```

## Veritabani Semasi
Veritabani kullanilmiyor.

## Onemli Modeller
- OpenSCADAIUI sinifi ([openscad_ai_ui.py](openscad_ai_ui.py)): UI state, event handling, generation worker, preview renderer.
- Docs cache payload modeli ([openscad_docs_context.py](openscad_docs_context.py)): version, synced_at_utc, source_count, sources[] alanlari.
- Prompt mesaj modeli ([prompt_to_openscad.py](prompt_to_openscad.py)): system+user mesajlari, docs_context ve repair_context birlesimi.

## State Management
- Merkezi state Tkinter degiskenleri ile tutulur: provider_var, model_var, key_var, outputs_dir_var, status_var vb.
- UI log/event akisinda thread-safe queue kullanilir.
- Dokuman state'i disk tabanli JSON cache dosyasi ile yonetilir (.openscad_docs_cache.json).

## Ekran/Route Haritasi

```text
OpenSCAD AI UI
|- Prompt Editor
|  |- Reference Image secimi
|  `- Image -> Prompt analizi
|- Provider/Model/Key ayarlari
|- Generate aksiyonu
|  `- prompt_to_openscad.py calisir
|     |- docs context hazirla
|     |- AI kod uretimi
|     |- OpenSCAD dogrulama
|     `- SCAD cikti yazma
`- Outputs paneli
   |- Dosya listesi
  |- SCAD odakli gorunum
   `- Acma/Silme islemleri
```

## Bagimliliklar

| Paket | Versiyon | Amac |
|---|---|---|
| Python | 3.9+ | Ana calisma ortami |
| OpenSCAD CLI | sistem kurulu | SCAD dogrulama ve export |
| tkinter | stdlib | Masaustu UI |
| urllib | stdlib | HTTP API ve docs fetch |
| json/re/subprocess/pathlib | stdlib | veri isleme, proses ve dosya yonetimi |

## Platform Izinleri

| Izin | Durum (Y/N) |
|---|---|
| Dosya okuma/yazma (prompt, outputs, cache) | Y |
| Ag cikisi (OpenAI/Gemini/Ollama/docs fetch) | Y |
| Harici proses calistirma (openscad, codex) | Y |
| Mikrofon/kamera | N |
| Kalici servis/daemon | N |

## API Entegrasyonlari
- Gemini:
  - POST /v1beta/models/{model}:generateContent
  - GET /v1beta/models
- OpenAI:
  - POST /v1/chat/completions
  - GET /v1/models
- Ollama (local):
  - POST /api/chat
  - GET /api/tags
- Codex CLI:
  - codex exec (schema output + image input optional)
- Official OpenSCAD docs:
  - https://openscad.org/documentation.html
  - ilgili wikibooks referans sayfalari (cache sync)

## Bilinen Sorunlar / Teknik Borc
1. Ilk docs sync internet gecikmesine bagli olarak yavas olabilir.
2. Buyuk docs context, model token kullanimini artirabilir.
3. openscad/ vendor klasoru buyuk oldugu icin tam repo taramalari pahali olabilir.

## Build & Calistirma

```powershell
# UI
.\run-openscad-ai-ui.ps1

# CLI
.\run-openscad-ai.ps1 -Prompt "parametric phone stand" -Provider gemini

# Force docs sync
python .\prompt_to_openscad.py --sync-docs --provider gemini "phone stand with cable hole"
```

## Kodlama Kurallari
- Tum yeni fonksiyonlarda tip ipucu kullan.
- Prompt ciktilari yalnizca gecerli OpenSCAD kodu olmali.
- API key degerlerini loglarda maskele.
- Degisikliklerde mevcut UI akislarini bozmadan geriye uyumlulugu koru.
- Dokuman baglami bulunamazsa fallback guidance ile calismaya devam et (hard fail yapma).
