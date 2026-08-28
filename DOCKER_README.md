# Crypto Signal — Docker + VPN

Node.js trading/market-data application yang dijalankan di Docker dengan **Gluetun + WireGuard** sebagai VPN gateway.

Arsitektur ini digunakan agar:

- Aplikasi Node.js dapat mengakses Binance melalui VPN.
- Traffic internet dari aplikasi tidak menggunakan koneksi host secara langsung.
- VPN hanya berlaku untuk container, bukan seluruh komputer.
- Website/aplikasi lain di Windows tetap menggunakan koneksi normal.
- Port web aplikasi `11000` tetap dapat diakses dari Windows.
- WireGuard configuration dapat diganti tanpa mengubah source code aplikasi.

---

# 1. Architecture

Project menggunakan dua container:

```text
Windows
│
├── Browser
│     │
│     └── http://localhost:11000
│
└── Docker
      │
      ├── crypto-signal-vpn
      │      ├── Gluetun
      │      ├── WireGuard
      │      └── VPN connection
      │
      └── crypto-signal
             │
             ├── Node.js
             ├── REST API Binance
             ├── Binance WebSocket
             └── Web application
```

Network aplikasi menggunakan network namespace milik VPN:

```yaml
network_mode: "service:vpn"
```

Dengan konfigurasi tersebut:

```text
crypto-signal
      │
      │ network namespace
      ▼
crypto-signal-vpn
      │
      ▼
WireGuard
      │
      ▼
Proton VPN
      │
      ▼
Internet
      │
      ▼
Binance
```

Jadi `crypto-signal` tidak memiliki network interface Docker sendiri.

---

# 2. Container

Terdapat dua service utama:

## VPN

```text
crypto-signal-vpn
```

Image:

```text
qmcgaw/gluetun:latest
```

Fungsi:

- Menjalankan Gluetun.
- Menjalankan WireGuard.
- Menjadi network gateway aplikasi.
- Menyediakan DNS untuk aplikasi.
- Menjalankan VPN kill-switch.
- Mempublish port aplikasi ke Windows.

## Application

```text
crypto-signal
```

Fungsi:

- Menjalankan Node.js.
- Mengambil data Binance REST API.
- Mengambil data Binance WebSocket.
- Menjalankan market/trading analysis.
- Menyediakan web interface.

Application menggunakan:

```yaml
network_mode: "service:vpn"
```

Artinya network aplikasi mengikuti container VPN.

---

# 3. Project Structure

Contoh struktur project:

```text
crypto-signal/
│
├── docker-compose.yml
├── Dockerfile
├── package.json
├── package-lock.json
├── .dockerignore
├── .gitignore
├── .env
│
├── gluetun/
│   └── wireguard/
│       └── wg0.conf
│
├── src/
│   ├── config/
│   │   └── env.js
│   │
│   ├── services/
│   │   ├── binance.service.js
│   │   └── market.service.js
│   │
│   └── ...
│
└── server.js
```

---

# 4. Important Files

## `docker-compose.yml`

Docker Compose mengatur dua container:

```yaml
services:
  vpn:
    image: qmcgaw/gluetun:latest
    container_name: crypto-signal-vpn

    cap_add:
      - NET_ADMIN

    devices:
      - /dev/net/tun:/dev/net/tun

    volumes:
      - ./gluetun:/gluetun:ro

    environment:
      VPN_SERVICE_PROVIDER: custom
      VPN_TYPE: wireguard
      TZ: Asia/Jakarta

    ports:
      - "${PORT:-11000}:${PORT:-11000}"

    restart: unless-stopped

  app:
    build: .
    container_name: crypto-signal

    network_mode: "service:vpn"

    env_file:
      - .env

    volumes:
      - .:/app
      - /app/node_modules

    depends_on:
      vpn:
        condition: service_healthy

    restart: unless-stopped
```

Hal penting:

```yaml
network_mode: "service:vpn"
```

Jangan menggantinya dengan:

```yaml
networks:
  - ...
```

jika tujuan arsitektur adalah membuat seluruh traffic `crypto-signal` melewati VPN.

---

# 5. Port 11000

Port aplikasi dipublish melalui:

```text
crypto-signal-vpn
```

bukan melalui:

```text
crypto-signal
```

Karena `crypto-signal` menggunakan network namespace VPN.

Contoh:

```yaml
ports:
  - "${PORT:-11000}:${PORT:-11000}"
```

Jika `.env` berisi:

```env
PORT=11000
```

Docker akan membuat:

```text
Windows :11000
       ↓
VPN container :11000
       ↓
Node.js :11000
```

Akses dari Windows:

```text
http://localhost:11000
```

---

# 6. Environment Variables

Aplikasi tetap menggunakan `.env` lokal.

Contoh:

```env
PORT=11000

MARKET_LIST=BTCUSDT,SOLUSDT
TIMEFRAME_LIST=1m,15m,1h,4h,1d
```

`PORT` digunakan oleh:

1. Node.js application.
2. Docker Compose untuk port publishing.

Kode Node.js tetap menggunakan:

```javascript
PORT: process.env.PORT || 11000;
```

Tidak perlu mengganti menjadi `APP_PORT`.

---

# 7. `.env` Tidak Dibuild ke Image

`.env` tidak perlu dimasukkan ke Docker image.

Compose membaca:

```yaml
env_file:
  - .env
```

sehingga environment diberikan saat container dijalankan.

Source code tetap menggunakan:

```javascript
require("dotenv").config();
```

Untuk development lokal:

```bash
node server.js
```

atau:

```bash
npm run dev
```

Docker akan menggunakan environment yang sama dari `.env`.

---

# 8. WireGuard Configuration

File:

```text
gluetun/wireguard/wg0.conf
```

digunakan oleh Gluetun.

Contoh struktur:

```ini
[Interface]
PrivateKey = YOUR_PRIVATE_KEY
Address = 10.x.x.x/32
DNS = 10.x.x.x

[Peer]
PublicKey = YOUR_SERVER_PUBLIC_KEY
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = SERVER_IP:51820
PersistentKeepalive = 25
```

### Security

Jangan commit:

```text
PrivateKey
```

ke Git repository.

Pastikan `wg0.conf` masuk `.gitignore` jika file tersebut mengandung private key.

---

# 9. Mendapatkan WireGuard Config Proton VPN

Gunakan akun Proton VPN untuk membuat/download WireGuard configuration.

Pilih:

```text
VPN → Downloads → WireGuard configuration
```

Kemudian pilih:

```text
Platform:
GNU/Linux

Protocol:
WireGuard
```

Pilih server yang ingin digunakan.

Untuk free account, pilih server yang memiliki:

```text
FREE
```

Setelah config dibuat/download, simpan sebagai:

```text
gluetun/wireguard/wg0.conf
```

Jangan mengubah struktur:

```ini
[Interface]
...

[Peer]
...
```

kecuali memahami parameter WireGuard yang digunakan.

---

# 10. Menjalankan Docker

Build dan start:

```bash
docker compose up -d --build
```

Untuk menjalankan tanpa rebuild:

```bash
docker compose up -d
```

Cek status:

```bash
docker compose ps
```

Expected:

```text
NAME                STATUS
crypto-signal       Up
crypto-signal-vpn   Up (healthy)
```

---

# 11. Melihat Log VPN

Gunakan:

```bash
docker logs crypto-signal-vpn
```

atau:

```bash
docker compose logs vpn
```

Follow realtime:

```bash
docker compose logs -f vpn
```

Log yang menunjukkan VPN berhasil:

```text
wireguard setup is complete
```

dan:

```text
Public IP address is xxx.xxx.xxx.xxx
```

Contoh:

```text
INFO [ip getter] Public IP address is 155.xxx.xxx.xxx
```

Perhatikan bahwa IP tersebut harus berbeda dari IP publik koneksi Windows jika VPN berhasil digunakan.

---

# 12. Mengecek Public IP dari Container

Ini adalah test paling penting.

Jalankan:

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

Contoh:

```text
155.117.189.21
```

Kemudian dari Windows:

```powershell
curl.exe https://api.ipify.org
```

Contoh:

```text
216.243.116.80
```

Jika:

```text
Windows       = 216.243.116.80
crypto-signal = 155.117.189.21
```

maka traffic aplikasi sudah keluar melalui VPN.

---

# 13. Mengecek DNS

Container:

```bash
docker exec crypto-signal cat /etc/resolv.conf
```

Pada konfigurasi Gluetun, DNS dapat terlihat seperti:

```text
nameserver 127.0.0.1
```

Ini normal apabila DNS resolver Gluetun digunakan dalam network namespace tersebut.

Test DNS:

```bash
docker exec crypto-signal node -e "require('dns').lookup('api.ipify.org', (e,a,f)=>console.log({error:e?.code,address:a,family:f}))"
```

Expected:

```text
{
  error: undefined,
  address: '...',
  family: 4
}
```

---

# 14. Mengecek Apakah Application Menggunakan VPN

Periksa network mode:

```bash
docker inspect crypto-signal --format "{{.HostConfig.NetworkMode}}"
```

Expected:

```text
container:<VPN_CONTAINER_ID>
```

atau bentuk network namespace yang merujuk ke container VPN.

Kemudian:

```bash
docker inspect crypto-signal-vpn --format "{{json .NetworkSettings.Networks}}"
```

Application tidak perlu memiliki IP Docker terpisah ketika menggunakan:

```yaml
network_mode: "service:vpn"
```

Ini berbeda dengan konfigurasi Docker bridge biasa.

---

# 15. Mengecek Port 11000

Jalankan:

```bash
docker compose ps
```

Expected:

```text
crypto-signal-vpn   ...   0.0.0.0:11000->11000/tcp
```

Perhatikan bahwa port muncul pada:

```text
crypto-signal-vpn
```

bukan:

```text
crypto-signal
```

Test dari Windows:

```powershell
curl.exe http://localhost:11000
```

atau buka:

```text
http://localhost:11000
```

---

# 16. Restart Normal

Jika VPN atau application perlu direstart:

```bash
docker compose restart
```

atau:

```bash
docker compose up -d
```

Jika Dockerfile atau dependency berubah:

```bash
docker compose up -d --build
```

---

# 17. Jangan Menggunakan `docker start vpn` untuk Recovery Normal

Hindari workflow:

```bash
docker stop crypto-signal-vpn
docker start crypto-signal-vpn
```

kemudian langsung menjalankan test application.

`docker start` berarti container sudah dijalankan, tetapi VPN belum tentu sudah:

```text
healthy
```

Gunakan:

```bash
docker compose up -d
```

untuk mengelola seluruh stack.

Cek:

```bash
docker compose ps
```

Pastikan:

```text
crypto-signal-vpn   Up (healthy)
crypto-signal       Up
```

sebelum melakukan test API.

---

# 18. Failure Scenario: VPN Mati

Jika VPN mati:

```text
crypto-signal-vpn
       ↓
VPN DOWN
       ↓
DNS / network tidak tersedia
       ↓
crypto-signal
       ↓
request gagal
```

Contoh error Node.js:

```text
EAI_AGAIN
```

Ini **lebih baik daripada fallback ke koneksi host**, karena aplikasi tidak seharusnya diam-diam menggunakan IP asli.

Test:

```bash
docker stop crypto-signal-vpn
```

Kemudian:

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

Request seharusnya gagal.

Ini menunjukkan bahwa traffic aplikasi tidak fallback ke network Windows.

---

# 19. Recovery Setelah VPN Mati

Jangan langsung:

```bash
docker start crypto-signal-vpn
```

Gunakan:

```bash
docker compose up -d
```

Kemudian tunggu:

```bash
docker compose ps
```

hingga:

```text
crypto-signal-vpn   Up (healthy)
```

Setelah itu test:

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

---

# 20. Troubleshooting: Binance HTTP 451

Jika muncul:

```text
Binance REST Error:
Request failed with status code 451
```

atau:

```text
Binance WS Error:
Unexpected server response: 451
```

jangan langsung mengubah kode Node.js.

HTTP `451` menunjukkan request ditolak berdasarkan restriction tertentu, yang dapat berkaitan dengan lokasi/geographic availability atau kebijakan endpoint.

Pertama cek public IP:

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

Kemudian cek lokasi IP tersebut menggunakan layanan IP geolocation.

---

# 21. Test Binance REST Secara Langsung

Test:

```bash
docker exec crypto-signal node -e "require('https').get('https://api.binance.com/api/v3/time', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log('HTTP', r.statusCode, d)); }).on('error', console.error)"
```

Jika hasil:

```text
HTTP 200
```

network/VPN kemungkinan dapat mengakses Binance.

Jika:

```text
HTTP 451
```

masalah kemungkinan berada pada:

```text
VPN exit IP
        ↓
geolocation
        ↓
Binance restriction
```

bukan pada Axios atau kode aplikasi.

---

# 22. Test WebSocket Binance

Jika REST berhasil tetapi WebSocket gagal, periksa WebSocket secara terpisah.

Jika keduanya:

```text
REST      → 451
WebSocket → 451
```

kemungkinan besar masalah berada pada network/exit IP.

Jika:

```text
REST      → 200
WebSocket → 451
```

baru lakukan debugging khusus terhadap WebSocket endpoint/configuration.

---

# 23. VPN IP Berbeda dengan VPN Server Name

Jangan hanya melihat nama server Proton.

Misalnya konfigurasi diberi nama:

```text
SG-FREE#12
```

tetapi yang menentukan akses aktual adalah:

```text
Public IP
```

dan geolocation IP tersebut.

Karena itu selalu verifikasi:

```bash
docker exec crypto-signal ...
```

terhadap:

```text
api.ipify.org
```

dan jangan hanya mengandalkan nama server di Proton.

---

# 24. Troubleshooting Checklist

Jika Binance tidak bisa diakses, lakukan urutan berikut.

### Step 1 — VPN running

```bash
docker compose ps
```

Harus:

```text
crypto-signal-vpn   Up (healthy)
```

### Step 2 — Public IP

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

### Step 3 — DNS

```bash
docker exec crypto-signal node -e "require('dns').lookup('api.binance.com', (e,a,f)=>console.log({error:e?.code,address:a,family:f}))"
```

### Step 4 — Binance REST

```bash
docker exec crypto-signal node -e "require('https').get('https://api.binance.com/api/v3/time', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log('HTTP',r.statusCode,d)); }).on('error', console.error)"
```

### Step 5 — VPN log

```bash
docker compose logs --tail=100 vpn
```

### Step 6 — Application log

```bash
docker compose logs --tail=100 app
```

---

# 25. Troubleshooting Matrix

| Problem                                  | Kemungkinan                         | Pemeriksaan                      |
| ---------------------------------------- | ----------------------------------- | -------------------------------- |
| VPN `Exited`                             | Gluetun/WireGuard error             | `docker compose logs vpn`        |
| VPN `unhealthy`                          | VPN belum siap / DNS / connectivity | `docker inspect` + logs          |
| `EAI_AGAIN`                              | DNS/VPN tidak tersedia              | cek DNS + VPN health             |
| IP container = IP Windows                | Traffic tidak melewati VPN          | cek `network_mode`               |
| Binance `451`                            | Exit IP/location restriction        | cek public IP                    |
| REST 451 + WS 451                        | kemungkinan restriction network/IP  | ganti VPN exit                   |
| REST OK + WS 451                         | masalah khusus WebSocket            | debug WS                         |
| Port 11000 tidak bisa                    | port publish / Node listen issue    | `docker compose ps`              |
| App tidak start                          | dependency / Node error             | `docker compose logs app`        |
| Source berubah tapi Docker tidak berubah | bind mount/dependency issue         | cek volume + `docker compose ps` |

---

# 26. Development Mode

Project menggunakan bind mount:

```yaml
volumes:
  - .:/app
  - /app/node_modules
```

Dengan demikian source code lokal:

```text
D:\Workspaces\www\crypto\crypto-signal
```

terhubung langsung ke:

```text
/app
```

di container.

Perubahan source code dapat langsung digunakan oleh `nodemon`.

Contoh:

```bash
docker compose up -d
```

Tidak perlu rebuild untuk setiap perubahan `.js`.

---

# 27. Kapan Perlu `--build`

### Source `.js` berubah

Tidak perlu:

```bash
docker compose up -d
```

Jika nodemon aktif, aplikasi akan restart otomatis.

### `.env` berubah

Restart container:

```bash
docker compose up -d
```

atau:

```bash
docker compose restart app
```

### `package.json` berubah

Rebuild:

```bash
docker compose up -d --build
```

### `package-lock.json` berubah

Rebuild:

```bash
docker compose up -d --build
```

### `Dockerfile` berubah

Rebuild:

```bash
docker compose up -d --build
```

### `docker-compose.yml` berubah

Jalankan:

```bash
docker compose up -d
```

Jika diperlukan:

```bash
docker compose up -d --build
```

---

# 28. Stop dan Remove

Stop:

```bash
docker compose stop
```

Remove container:

```bash
docker compose down
```

Remove container sekaligus network project:

```bash
docker compose down
```

Jangan menghapus konfigurasi WireGuard secara manual.

---

# 29. Full Recreate

Jika konfigurasi Docker berubah dan ingin membuat ulang seluruh stack:

```bash
docker compose down
docker compose up -d --build
```

Kemudian:

```bash
docker compose ps
```

Pastikan VPN:

```text
healthy
```

dan aplikasi:

```text
Up
```

---

# 30. Security

Jangan commit file yang mengandung secret:

```text
.env
wg0.conf
```

terutama:

```text
PrivateKey
```

Gunakan `.gitignore`.

Jika private key pernah terlanjur masuk Git repository publik:

1. Revoke WireGuard configuration.
2. Generate configuration baru.
3. Ganti private key.
4. Hapus secret dari repository history.

---

# 31. Operational Principle

Arsitektur ini sengaja menggunakan VPN sebagai **network boundary**:

```text
                ┌─────────────────────────┐
                │       Windows Host      │
                │                         │
                │ Browser / Other Apps    │
                │        │                │
                │        │ normal network │
                │        ▼                │
                │      Internet            │
                │                         │
                │ Docker                  │
                │                         │
                │  ┌───────────────────┐  │
                │  │ crypto-signal-vpn │  │
                │  │                   │  │
                │  │    WireGuard      │  │
                │  │        │          │  │
                │  │        ▼          │  │
                │  │    Proton VPN     │  │
                │  └─────────▲─────────┘  │
                │            │            │
                │  ┌─────────┴─────────┐  │
                │  │   crypto-signal   │  │
                │  │                   │  │
                │  │ Node.js           │  │
                │  │ Binance REST      │  │
                │  │ Binance WebSocket │  │
                │  └───────────────────┘  │
                └─────────────────────────┘
```

Dengan demikian VPN hanya mempengaruhi traffic:

```text
crypto-signal
```

dan tidak mempengaruhi:

```text
Browser Windows
Git
IDE
Website lain
Aplikasi Windows lainnya
```

---

# 32. Quick Commands

### Start

```bash
docker compose up -d
```

### Start + rebuild

```bash
docker compose up -d --build
```

### Status

```bash
docker compose ps
```

### VPN logs

```bash
docker compose logs -f vpn
```

### Application logs

```bash
docker compose logs -f app
```

### Public IP

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

### Stop

```bash
docker compose stop
```

### Remove

```bash
docker compose down
```

### Full rebuild

```bash
docker compose down
docker compose up -d --build
```

---

# 33. Expected Final State

Kondisi normal:

```text
crypto-signal-vpn
    │
    ├── Gluetun       ✓
    ├── WireGuard     ✓
    ├── VPN           ✓
    ├── DNS           ✓
    └── Port 11000   ✓
           │
           ▼
    crypto-signal
    ├── Node.js       ✓
    ├── REST API      ✓
    ├── WebSocket     ✓
    └── Web :11000    ✓
```

Verifikasi akhir:

```bash
docker compose ps
```

```text
crypto-signal-vpn   Up (healthy)
crypto-signal       Up
```

Public IP:

```bash
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x=>d+=x); r.on('end', ()=>console.log(d)); }).on('error', console.error)"
```

dan:

```text
Container IP ≠ Windows IP
```

Port:

```text
http://localhost:11000
```

harus dapat diakses dari Windows.
