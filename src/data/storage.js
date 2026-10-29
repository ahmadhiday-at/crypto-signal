const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Names become file paths, so only strict symbol/timeframe formats are accepted.
const MARKET_RE = /^[A-Z0-9]{2,20}$/;
const TF_RE = /^\d{1,2}[mhdw]$/;

class StorageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StorageError';
        this.code = 'storage_failed';
    }
}

function assertName(market, timeframe) {
    if (typeof market !== 'string' || !MARKET_RE.test(market)) throw new StorageError(`Invalid market name: ${String(market).slice(0, 30)}`);
    if (timeframe !== undefined && (typeof timeframe !== 'string' || !TF_RE.test(timeframe))) {
        throw new StorageError(`Invalid timeframe: ${String(timeframe).slice(0, 10)}`);
    }
}

class StorageService {
    constructor(baseDir = path.join(__dirname, '../../data')) {
        this.chartDataDir = path.join(baseDir, 'chart');
        this.marketDataDir = path.join(baseDir, 'market');
    }

    async ensureDirs() {
        await fs.mkdir(this.chartDataDir, { recursive: true });
        await fs.mkdir(this.marketDataDir, { recursive: true });
    }

    // Removes temp files left behind by an interrupted write.
    async cleanupTempFiles() {
        for (const dir of [this.chartDataDir, this.marketDataDir]) {
            let files = [];
            try {
                files = await fs.readdir(dir);
            } catch (e) {
                continue;
            }
            for (const f of files) {
                if (f.endsWith('.tmp')) await fs.unlink(path.join(dir, f)).catch(() => {});
            }
        }
    }

    // Writes JSON atomically: unique temp file, fsync, then rename over the target.
    async _atomicWrite(filePath, data) {
        let json;
        try {
            json = JSON.stringify(data, null, 2);
        } catch (e) {
            throw new StorageError(`Data is not serialisable: ${e.message}`);
        }
        const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        try {
            await this.ensureDirs();
            const handle = await fs.open(tempPath, 'w');
            try {
                await handle.writeFile(json);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await fs.rename(tempPath, filePath);
        } catch (err) {
            await fs.unlink(tempPath).catch(() => {});
            throw new StorageError(`Failed to write ${path.basename(filePath)}: ${err.code || err.message}`);
        }
    }

    // Returns { data } on success, { data: null, reason: 'not_found' | 'corrupt' | 'unreadable' } otherwise.
    async _read(filePath) {
        let content;
        try {
            content = await fs.readFile(filePath, 'utf8');
        } catch (e) {
            return { data: null, reason: e.code === 'ENOENT' ? 'not_found' : 'unreadable' };
        }
        try {
            return { data: JSON.parse(content) };
        } catch (e) {
            console.warn(`[Storage] Ignoring corrupt JSON in ${path.basename(filePath)}`);
            return { data: null, reason: 'corrupt' };
        }
    }

    snapshotPath(market, timeframe) {
        assertName(market, timeframe);
        return path.join(this.chartDataDir, `${market}_${timeframe}.json`);
    }

    marketPath(market) {
        assertName(market);
        return path.join(this.marketDataDir, `${market}.json`);
    }

    async writeSnapshot(market, timeframe, data) {
        await this._atomicWrite(this.snapshotPath(market, timeframe), data);
    }

    async writeMarketSnapshot(market, data) {
        await this._atomicWrite(this.marketPath(market), data);
    }

    async readSnapshotResult(market, timeframe) {
        return this._read(this.snapshotPath(market, timeframe));
    }

    async readMarketSnapshotResult(market) {
        return this._read(this.marketPath(market));
    }

    async readSnapshot(market, timeframe) {
        return (await this.readSnapshotResult(market, timeframe)).data;
    }

    async readMarketSnapshot(market) {
        return (await this.readMarketSnapshotResult(market)).data;
    }
}

module.exports = new StorageService();
module.exports.StorageService = StorageService;
module.exports.StorageError = StorageError;
