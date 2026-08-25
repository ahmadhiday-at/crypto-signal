# Crypto Signal — Docker Development

Environment Docker untuk menjalankan aplikasi Node.js `crypto-signal`.

Project ini menggunakan Docker untuk menjalankan aplikasi Node.js melalui network `docker-gateway`, yang disediakan oleh project VPN terpisah.

## Arsitektur

```text
Windows
│
├── Browser
│      │
│      └── http://localhost:${PORT}
│
└── Docker
       │
       └── crypto-signal
              │
              ├── Node.js
              ├── Nodemon
              │
              └── docker-gateway
                     │
                     └── VPN Gateway
```

Project VPN **tidak berada di repository ini**.

Project ini hanya menggunakan Docker network:

```text
docker-gateway
```

Network tersebut harus sudah dibuat oleh project:

```text
docker-gateway-net
```

---

# 1. Requirements

Pastikan sudah tersedia:

- Docker Desktop
- Docker Compose
- Project `docker-gateway-net`
- Docker network `docker-gateway`

Cek Docker:

```powershell
docker version
```

```powershell
docker compose version
```

---

# 2. Pastikan VPN Gateway Aktif

Project `crypto-signal` membutuhkan network:

```text
docker-gateway
```

Pastikan network tersedia:

```powershell
docker network ls
```

Harus terdapat:

```text
docker-gateway
```

Kemudian pastikan VPN gateway aktif:

```powershell
docker ps
```

Harus terdapat:

```text
docker-gateway-vpn
```

Jika belum aktif, jalankan project VPN terlebih dahulu:

```powershell
cd D:\Workspaces\www\php\php5.6\devadmin\docker-gateway-net

docker compose up -d
```

---

# 3. Struktur Project

Contoh lokasi project:

```text
D:\Workspaces\www\crypto\crypto-signal
```

Struktur:

```text
crypto-signal/
│
├── .env
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
│
└── src/
    ├── config/
    │   └── env.js
    │
    ├── services/
    │   └── ...
    │
    └── ...
```

---

# 4. Environment

Aplikasi menggunakan file:

```text
.env
```

Contoh:

```env
PORT=11000

MARKET_LIST=BTCUSDT
TIMEFRAME_LIST=15m
TIMEFRAME_LABELS=

TF_HTF=1d
TF_STRUCTURE=4h
TF_MID=1h
TF_ENTRY=15m

WEIGHT_1D=3.0
WEIGHT_4H=2.0
WEIGHT_1H=1.5
WEIGHT_15M=1.0
WEIGHT_1W=1.0
WEIGHT_1M=1.0
```

File `.env` bersifat lokal dan **tidak boleh di-commit ke Git**.

Gunakan:

```text
.env.example
```

sebagai template konfigurasi.

---

# 5. Docker Compose

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    container_name: crypto-signal

    ports:
      - "${PORT:-11000}:${PORT:-11000}"

    env_file:
      - .env

    volumes:
      - .:/app
      - /app/node_modules

    networks:
      - docker-gateway

networks:
  docker-gateway:
    external: true
```

## Penjelasan

### Port

```yaml
ports:
  - "${PORT:-11000}:${PORT:-11000}"
```

Port berasal dari `.env`.

Jika:

```env
PORT=11000
```

maka:

```text
Windows :11000
      ↓
Container :11000
```

Jika:

```env
PORT=12000
```

maka:

```text
Windows :12000
      ↓
Container :12000
```

Tidak perlu mengubah `Dockerfile`.

---

# 6. Environment Container

```yaml
env_file:
  - .env
```

Docker Compose membaca `.env` lokal dan memasukkan nilainya sebagai environment variable ke process Node.js.

Contoh:

```env
PORT=11000
MARKET_LIST=BTCUSDT
```

akan tersedia di Node.js sebagai:

```js
process.env.PORT;
process.env.MARKET_LIST;
```

File `.env` **tidak di-mount ke container**.

Artinya container tidak membutuhkan:

```text
/app/.env
```

Environment diberikan langsung kepada process.

---

# 7. Source Code Live Reload

Compose menggunakan:

```yaml
volumes:
  - .:/app
  - /app/node_modules
```

Artinya source code lokal di:

```text
D:\Workspaces\www\crypto\crypto-signal
```

di-mount ke:

```text
/app
```

dalam container.

Contoh:

```text
Local:

src/server.js
     │
     │ bind mount
     ▼
Container:

/app/src/server.js
```

---

# 8. Nodemon

Container menggunakan:

```dockerfile
CMD ["npm", "run", "dev"]
```

dan `package.json`:

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

Maka perubahan source code akan dideteksi oleh Nodemon.

Contoh:

```text
Edit:
src/services/binance.js

        ↓

File berubah

        ↓

Nodemon mendeteksi perubahan

        ↓

Node.js restart

        ↓

Aplikasi menggunakan kode terbaru
```

Tidak perlu rebuild image setiap kali mengubah file `.js`.

---

# 9. Dockerfile

Dockerfile:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "run", "dev"]
```

Tidak perlu menggunakan:

```dockerfile
EXPOSE 11000
```

Port aplikasi dikontrol oleh:

```text
.env
   ↓
docker-compose.yml
   ↓
Node.js
```

`EXPOSE` bukan mekanisme port mapping dan tidak diperlukan untuk konfigurasi ini.

---

# 10. Build pertama

Dari directory project:

```powershell
cd D:\Workspaces\www\crypto\crypto-signal
```

Jalankan:

```powershell
docker compose up -d --build
```

Docker akan:

1. membuat image Node.js;
2. menginstall dependencies;
3. membuat container;
4. menghubungkan container ke `docker-gateway`;
5. menjalankan Nodemon.

---

# 11. Menjalankan setelah image sudah dibuat

Untuk penggunaan normal:

```powershell
docker compose up -d
```

Tidak perlu:

```powershell
docker compose build
```

setiap kali mengubah source code.

Nodemon menangani perubahan source code.

---

# 12. Development Workflow

## Mengubah JavaScript

Misalnya:

```text
src/server.js
src/services/binance.js
src/config/env.js
```

Tidak perlu Docker command.

Cukup edit dan save.

Nodemon akan restart aplikasi.

---

## Mengubah HTML/CSS/JS Web

Tidak perlu rebuild.

File sudah di-bind:

```text
host
 ↓
/app
```

Jika web application memiliki mekanisme browser reload, browser juga dapat langsung melihat perubahan tersebut.

---

## Mengubah `.env`

Perubahan `.env` **tidak otomatis mengubah environment container yang sedang berjalan**.

Setelah mengubah:

```env
PORT=12000
```

jalankan:

```powershell
docker compose up -d --force-recreate
```

Tidak perlu `--build`.

---

## Mengubah `docker-compose.yml`

Jalankan:

```powershell
docker compose up -d
```

Jika perubahan membutuhkan recreate container:

```powershell
docker compose up -d --force-recreate
```

---

## Mengubah `Dockerfile`

Harus rebuild:

```powershell
docker compose up -d --build
```

---

## Mengubah `package.json`

Jika menambah/mengubah dependency:

```powershell
docker compose up -d --build
```

Contoh:

```bash
npm install ws
```

Kemudian:

```powershell
docker compose up -d --build
```

---

# 13. Command Reference

## Start

```powershell
docker compose up -d
```

## Start + Build

```powershell
docker compose up -d --build
```

## Force recreate

```powershell
docker compose up -d --force-recreate
```

## Stop

```powershell
docker compose down
```

## Restart

```powershell
docker compose restart
```

## Status

```powershell
docker compose ps
```

## Logs

```powershell
docker compose logs -f
```

## Logs application

```powershell
docker logs -f crypto-signal
```

## Shell

```powershell
docker exec -it crypto-signal sh
```

## Check environment

```powershell
docker exec crypto-signal env
```

## Check Node.js

```powershell
docker exec crypto-signal node --version
```

## Check npm

```powershell
docker exec crypto-signal npm --version
```

---

# 14. Test Web

Jika:

```env
PORT=11000
```

buka:

```text
http://localhost:11000
```

Jika port diubah:

```env
PORT=12000
```

recreate:

```powershell
docker compose up -d --force-recreate
```

kemudian buka:

```text
http://localhost:12000
```

---

# 15. Test Network

Container harus terhubung ke:

```text
docker-gateway
```

Periksa:

```powershell
docker inspect crypto-signal --format "{{json .NetworkSettings.Networks}}"
```

Harus terdapat:

```text
docker-gateway
```

---

# 16. Test Public IP

Untuk memastikan container mendapatkan jalur network yang diinginkan:

```powershell
docker exec crypto-signal wget -qO- https://api.ipify.org
```

Jika image tidak memiliki `wget`, gunakan:

```powershell
docker exec crypto-signal node -e "require('https').get('https://api.ipify.org', r => { let d=''; r.on('data', x => d+=x); r.on('end', () => console.log(d)); })"
```

Bandingkan dengan Windows:

```powershell
curl.exe https://api.ipify.org
```

---

# 17. VPN Gateway

Project ini **tidak menjalankan VPN sendiri**.

VPN berada pada project:

```text
docker-gateway-net
```

Dengan struktur:

```text
docker-gateway-net
        │
        ▼
docker-gateway-vpn
        │
        ▼
WireGuard
        │
        ▼
Proton VPN
```

Sedangkan:

```text
crypto-signal
        │
        ▼
docker-gateway
```

---

# 18. Important: Shared Network ≠ Automatic VPN Routing

`crypto-signal` berada di:

```text
docker-gateway
```

tetapi bergabung ke Docker network yang sama **tidak secara otomatis menjamin semua traffic keluar melalui VPN**.

Target yang harus diverifikasi:

```text
crypto-signal
      │
      ▼
docker-gateway
      │
      ▼
docker-gateway-vpn
      │
      ▼
WireGuard
      │
      ▼
Proton
```

Bukan:

```text
crypto-signal
      │
      ▼
Docker default gateway
      │
      ▼
ISP
```

Sebelum aplikasi digunakan untuk Binance API, routing harus diuji.

---

# 19. Failure Scenario

VPN gateway mati:

```text
docker-gateway-vpn
        X
```

Aplikasi seharusnya **tidak melakukan fallback diam-diam ke koneksi ISP** jika aplikasi membutuhkan VPN.

Kondisi aman:

```text
crypto-signal
      │
      ▼
VPN gateway
      X
      │
    DROP
```

Kondisi berbahaya:

```text
crypto-signal
      │
      X VPN
      │
      ▼
Docker default route
      │
      ▼
ISP
```

Untuk aplikasi yang menggunakan credential/API Binance, routing dan kill-switch harus diverifikasi sebelum production use.

---

# 20. Git

`.env` tidak boleh masuk repository.

`.gitignore`:

```gitignore
.env
.env.*
!.env.example

node_modules/

npm-debug.log*
yarn-debug.log*
pnpm-debug.log*

.DS_Store
Thumbs.db

.vscode/
.idea/
```

Gunakan:

```text
.env.example
```

untuk mendokumentasikan variable yang diperlukan.

---

# 21. Docker Ignore

`.dockerignore`:

```text
node_modules
npm-debug.log*
.git
.gitignore

.env
.env.*
!.env.example

Dockerfile
docker-compose.yml
README.md

.vscode
.idea
.DS_Store
Thumbs.db
```

`Dockerfile` dan `docker-compose.yml` sebenarnya tidak wajib di-ignore, tetapi untuk image ini keduanya tidak diperlukan di runtime.

---

# 22. Daily Development Workflow

### Pertama kali

```powershell
cd D:\Workspaces\www\crypto\crypto-signal

docker compose up -d --build
```

### Setelah itu

Edit source code secara normal.

```text
src/
 ├── server.js
 ├── config/
 ├── services/
 └── ...
```

Nodemon akan melakukan restart otomatis.

### Jika mengubah `.env`

```powershell
docker compose up -d --force-recreate
```

### Jika mengubah dependency

```powershell
docker compose up -d --build
```

### Jika mengubah Dockerfile

```powershell
docker compose up -d --build
```

### Jika hanya mengubah `.js`

```text
Tidak perlu command Docker.
```

---

# 23. Ringkasan

| Perubahan            | Action                                  |
| -------------------- | --------------------------------------- |
| `.js`                | Tidak perlu Docker command              |
| HTML/CSS             | Tidak perlu rebuild                     |
| `.env`               | `docker compose up -d --force-recreate` |
| `docker-compose.yml` | `docker compose up -d`                  |
| `Dockerfile`         | `docker compose up -d --build`          |
| `package.json`       | `docker compose up -d --build`          |
| `package-lock.json`  | `docker compose up -d --build`          |

Target development:

```text
                    Windows
                       │
                       │ :11000
                       ▼
                ┌──────────────┐
                │ crypto-signal│
                │   Node.js    │
                │   Nodemon    │
                └──────┬───────┘
                       │
                       │ docker-gateway
                       ▼
                ┌──────────────┐
                │ VPN Gateway  │
                │   Gluetun    │
                └──────┬───────┘
                       │
                    WireGuard
                       │
                       ▼
                  Proton VPN
                       │
                       ▼
                    Binance
```

Tujuan utamanya adalah **development cepat tanpa rebuild setiap perubahan source**, sambil tetap memisahkan project aplikasi `crypto-signal` dari project VPN `docker-gateway-net`.
