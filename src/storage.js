const fs = require('fs').promises;
const path = require('path');

class StorageService {
    constructor() {
        this.chartDataDir = path.join(__dirname, '../data/chart');
        this.marketDataDir = path.join(__dirname, '../data/market');
    }

    async ensureDirs() {
        try {
            await fs.mkdir(this.chartDataDir, { recursive: true });
            await fs.mkdir(this.marketDataDir, { recursive: true });
        } catch (e) {
            console.error('Storage Dir Error:', e);
        }
    }

    async writeSnapshot(market, timeframe, data) {
        try {
            await this.ensureDirs();
            const filename = `${market}_${timeframe}.json`;
            const filePath = path.join(this.chartDataDir, filename);
            const tempPath = filePath + '.tmp';

            await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
            await fs.rename(tempPath, filePath);
        } catch (err) {
            console.error(`Storage Write Error [${market}/${timeframe}]:`, err);
            throw new Error('Failed to persist snapshot data');
        }
    }

    async writeMarketSnapshot(market, data) {
        try {
            await this.ensureDirs();
            const filePath = path.join(this.marketDataDir, `${market}.json`);
            const tempPath = filePath + '.tmp';

            await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
            await fs.rename(tempPath, filePath);
        } catch (err) {
            console.error(`Market Storage Write Error [${market}]:`, err);
            throw new Error('Failed to persist market snapshot');
        }
    }

    async readSnapshot(market, timeframe) {
        try {
            const filePath = path.join(this.chartDataDir, `${market}_${timeframe}.json`);
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    }

    async readMarketSnapshot(market) {
        try {
            const filePath = path.join(this.marketDataDir, `${market}.json`);
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    }

}

module.exports = new StorageService();
