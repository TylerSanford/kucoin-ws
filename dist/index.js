"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KuCoinWs = void 0;
const crypto_1 = require("crypto");
const emittery_1 = __importDefault(require("emittery"));
const ws_1 = __importDefault(require("ws"));
const got_1 = __importDefault(require("got"));
const queue_1 = __importDefault(require("queue"));
/** Root */
const util_1 = require("./util");
const const_1 = require("./const");
const event_handler_1 = require("./event-handler");
class KuCoinWs extends emittery_1.default {
    constructor() {
        super();
        this.queueProcessor = (0, queue_1.default)({ concurrency: 1, timeout: 250, autostart: true });
        this.rootApi = 'openapi-v2.kucoin.com';
        this.publicBulletEndPoint = 'https://openapi-v2.kucoin.com/api/v1/bullet-public';
        this.lengthConnectId = 24;
        this.retryTimeoutMs = 5000;
        this.subscriptions = [];
        this.socketOpen = false;
        this.askingClose = false;
        this.eventHandler = new event_handler_1.EventHandler(this);
    }
    async connect() {
        this.socketConnecting = true;
        const response = await got_1.default
            .post(this.publicBulletEndPoint, { headers: { host: this.rootApi } })
            .json();
        if (!response.data || !response.data.token) {
            const invalidTokenError = new Error('Invalid public token from KuCoin');
            this.socketConnecting = false;
            this.emit('error', invalidTokenError);
            throw invalidTokenError;
        }
        const { token, instanceServers } = response.data;
        const { endpoint, pingInterval } = instanceServers[0];
        this.askingClose = false;
        this.eventHandler.clearCandleCache();
        this.connectId = (0, crypto_1.randomBytes)(this.lengthConnectId).toString('hex');
        this.pingIntervalMs = pingInterval;
        this.wsPath = `${endpoint}?token=${token}&connectId=${this.connectId}`;
        await this.openWebsocketConnection();
        if (this.subscriptions.length) {
            this.restartPreviousSubscriptions();
        }
    }
    subscribeTicker(symbol) {
        this.requireSocketToBeOpen();
        const formatSymbol = symbol.replace('/', '-');
        const indexSubscription = `ticker-${symbol}`;
        if (this.subscriptions.includes(indexSubscription)) {
            return;
        }
        if (!this.ws.readyState) {
            this.emit('socket-not-ready', `socket not ready to subscribe ticker for: ${symbol}, retrying in ${this.retryTimeoutMs}ms`);
            const timer = setTimeout(() => this.subscribeTicker(symbol), this.retryTimeoutMs);
            timer.unref();
            return;
        }
        this.addSubscription(indexSubscription);
        this.queueProcessor.push(() => {
            const id = `sub-ticker-${Date.now()}`;
            this.send(JSON.stringify({
                id,
                type: 'subscribe',
                topic: `/market/ticker:${formatSymbol}`,
                privateChannel: false,
                response: true,
            }), (error) => {
                if (error) {
                    this.emit('error', error);
                    return this.removeSubscription(indexSubscription);
                }
                this.eventHandler.waitForEvent('ack', id, (result) => {
                    if (result) {
                        return;
                    }
                    this.removeSubscription(indexSubscription);
                });
            });
        });
    }
    unsubscribeTicker(symbol) {
        this.requireSocketToBeOpen();
        const formatSymbol = symbol.replace('/', '-');
        const indexSubscription = `ticker-${symbol}`;
        if (!this.subscriptions.includes(indexSubscription)) {
            return;
        }
        this.queueProcessor.push(() => {
            const id = `unsub-ticker-${Date.now()}`;
            this.send(JSON.stringify({
                id,
                type: 'unsubscribe',
                topic: `/market/ticker:${formatSymbol}`,
                privateChannel: false,
                response: true,
            }), (error) => {
                if (error) {
                    this.emit('error', error);
                    return this.addSubscription(indexSubscription);
                }
                this.eventHandler.waitForEvent('ack', id, (result) => {
                    if (result) {
                        return;
                    }
                    this.addSubscription(indexSubscription);
                });
            });
        });
        this.removeSubscription(indexSubscription);
    }
    subscribeCandle(symbol, interval) {
        this.requireSocketToBeOpen();
        const formatSymbol = symbol.replace('/', '-');
        const formatInterval = const_1.mapCandleInterval[interval];
        if (!formatInterval) {
            throw new TypeError(`Wrong format waiting for: ${Object.keys(const_1.mapCandleInterval).join(', ')}`);
        }
        const indexSubscription = `candle-${symbol}-${interval}`;
        if (this.subscriptions.includes(indexSubscription)) {
            return;
        }
        if (!this.ws.readyState) {
            this.emit('socket-not-ready', `socket not ready to subscribe candle for: ${symbol} ${interval}, retrying in ${this.retryTimeoutMs}ms`);
            const timer = setTimeout(() => this.subscribeCandle(symbol, interval), this.retryTimeoutMs);
            timer.unref();
            return;
        }
        this.addSubscription(indexSubscription);
        this.queueProcessor.push(() => {
            const id = `sub-candle-${Date.now()}`;
            this.send(JSON.stringify({
                id,
                type: 'subscribe',
                topic: `/market/candles:${formatSymbol}_${formatInterval}`,
                privateChannel: false,
                response: true,
            }), (error) => {
                if (error) {
                    this.emit('error', error);
                    return this.removeSubscription(indexSubscription);
                }
                this.eventHandler.waitForEvent('ack', id, (result) => {
                    if (result) {
                        return;
                    }
                    this.removeSubscription(indexSubscription);
                });
            });
        });
    }
    unsubscribeCandle(symbol, interval) {
        this.requireSocketToBeOpen();
        const formatSymbol = symbol.replace('/', '-');
        const formatInterval = const_1.mapCandleInterval[interval];
        if (!formatInterval) {
            throw new TypeError(`Wrong format waiting for: ${Object.keys(const_1.mapCandleInterval).join(', ')}`);
        }
        const indexSubscription = `candle-${symbol}-${interval}`;
        if (!this.subscriptions.includes(indexSubscription)) {
            return;
        }
        this.queueProcessor.push(() => {
            const id = `unsub-candle-${Date.now()}`;
            this.send(JSON.stringify({
                id,
                type: 'unsubscribe',
                topic: `/market/candles:${formatSymbol}_${formatInterval}`,
                privateChannel: false,
                response: true,
            }), (error) => {
                if (error) {
                    this.emit('error', error);
                    return this.addSubscription(indexSubscription);
                }
                this.eventHandler.waitForEvent('ack', id, (result) => {
                    if (result) {
                        this.eventHandler.deleteCandleCache(indexSubscription);
                        return;
                    }
                    this.addSubscription(indexSubscription);
                });
            });
        });
        this.removeSubscription(indexSubscription);
    }
    closeConnection() {
        if (this.subscriptions.length) {
            throw new Error(`You have activated subscriptions! (${this.subscriptions.length})`);
        }
        this.askingClose = true;
        this.ws.close();
    }
    isSocketOpen() {
        return this.socketOpen;
    }
    isSocketConnecting() {
        return this.socketConnecting;
    }
    getSubscriptionNumber() {
        return this.subscriptions.length;
    }
    removeSubscription(index) {
        if (!this.subscriptions.includes(index)) {
            return;
        }
        this.subscriptions = this.subscriptions.filter((fSub) => fSub !== index);
        this.emit('subscriptions', this.subscriptions);
    }
    addSubscription(index) {
        if (this.subscriptions.includes(index)) {
            return;
        }
        this.subscriptions.push(index);
        this.emit('subscriptions', this.subscriptions);
    }
    send(data, sendCb = util_1.noop) {
        if (!this.ws) {
            return;
        }
        this.ws.send(data, sendCb);
    }
    restartPreviousSubscriptions() {
        if (!this.socketOpen) {
            return;
        }
        if (!this.ws.readyState) {
            this.emit('socket-not-ready', 'retry later to restart previous subscriptions');
            const timer = setTimeout(() => this.restartPreviousSubscriptions(), this.retryTimeoutMs);
            timer.unref();
            return;
        }
        const previousSubs = [].concat(this.subscriptions);
        this.subscriptions.length = 0;
        for (const subscription of previousSubs) {
            const [type, symbol, timeFrame] = subscription.split('-');
            if (type === 'ticker') {
                this.subscribeTicker(symbol);
            }
            if (type === 'candle') {
                this.subscribeCandle(symbol, timeFrame);
            }
        }
    }
    requireSocketToBeOpen() {
        if (!this.socketOpen) {
            throw new Error('Please call connect before subscribing');
        }
    }
    sendPing() {
        this.requireSocketToBeOpen();
        this.send(JSON.stringify({
            id: Date.now(),
            type: 'ping',
        }));
    }
    startPing() {
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.sendPing(), this.pingIntervalMs);
    }
    stopPing() {
        clearInterval(this.pingTimer);
    }
    async reconnect() {
        await (0, util_1.delay)(this.retryTimeoutMs);
        this.emit('reconnect', `reconnect with ${this.subscriptions.length} sockets...`);
        this.connect();
    }
    async openWebsocketConnection() {
        if (this.socketOpen) {
            return;
        }
        this.ws = new ws_1.default(this.wsPath, {
            perMessageDeflate: false,
            handshakeTimeout: this.retryTimeoutMs,
        });
        this.ws.on('message', (data) => {
            this.eventHandler.processMessage(data);
        });
        this.ws.on('close', () => {
            this.queueProcessor.end();
            this.socketOpen = false;
            this.stopPing();
            this.ws = undefined;
            if (!this.askingClose) {
                this.reconnect();
            }
        });
        this.ws.on('error', (ws, error) => {
            this.emit('error', error);
        });
        await this.waitOpenSocket();
        const welcomeResult = await this.eventHandler.waitForEvent('welcome', this.connectId);
        if (!welcomeResult) {
            const welcomeError = new Error('No welcome message from KuCoin received!');
            this.emit('error', welcomeError);
            throw welcomeError;
        }
        this.socketOpen = true;
        this.socketConnecting = false;
        this.startPing();
    }
    waitOpenSocket() {
        return new Promise((resolve) => {
            this.ws.on('open', () => {
                resolve();
            });
        });
    }
}
exports.KuCoinWs = KuCoinWs;
//# sourceMappingURL=index.js.map