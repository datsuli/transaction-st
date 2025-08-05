class BlockExplorer {
    constructor() {
        this.apiBase = 'https://api-v1.freedom.st';
        this.socketUrl = 'https://sock-v1.freedom.st/sse';
        this.networks = ['btc', 'bch', 'ltc', 'doge', 'dash'];
        this.networkInfo = {};
        this.rates = {};
        this.eventSource = null;
        this.currentPage = 'home';
        this.latestTransactions = [];
        this.latestBlocks = [];
        
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupHashRouting();
        await this.loadNetworkStatus();
        await this.loadRates();
        this.updateLatestBlocks();
        this.connectToSocket();
        
        // Handle initial hash routing
        await this.handleInitialHash();
        
        // Hide loading screen
        this.hideLoadingScreen();
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }

    setupEventListeners() {
        const searchBtn = document.getElementById('searchBtn');
        const searchInput = document.getElementById('searchInput');

        searchBtn.addEventListener('click', () => this.performSearch());
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });
    }

    setupHashRouting() {
        window.addEventListener('hashchange', () => {
            this.handleHashChange();
        });
    }

    async handleInitialHash() {
        if (window.location.hash) {
            await this.handleHashChange();
        } else {
            // No hash, show home page
            this.currentPage = 'home';
            this.showPage('homePage');
            this.updateTitle('Transaction.st - Block Explorer');
        }
    }

    async handleHashChange() {
        const hash = window.location.hash.slice(1);
        
        if (!hash) {
            this.showHome();
            return;
        }
        
        const parts = hash.split('/');
        
        if (parts.length !== 2) {
            this.show404();
            return;
        }
        
        const [type, id] = parts;
        
        if (!id.trim()) {
            this.show404();
            return;
        }
        
        switch (type) {
            case 'tx':
                await this.showTransaction(id);
                break;
            case 'block':
                await this.searchBlockHash(id);
                break;
            case 'address':
                await this.showAddress(id);
                break;
            default:
                this.show404();
        }
    }

    updateHash(type, id) {
        const newHash = `#${type}/${id}`;
        if (window.location.hash !== newHash) {
            window.history.pushState(null, '', newHash);
        }
    }

    async loadNetworkStatus() {
        try {
            const response = await fetch(`${this.apiBase}/rpc/info`);
            const data = await response.json();
            
            this.networkInfo = data;
            this.displayNetworkStatus();
        } catch (error) {
            console.error('Failed to load network status:', error);
            this.displayNetworkError();
        }
    }

    displayNetworkStatus() {
        const container = document.getElementById('networkStatus');
        container.innerHTML = '';

        this.networks.forEach(network => {
            const networkData = this.networkInfo[network];
            const card = document.createElement('div');
            card.className = `network-item ${networkData ? 'online' : 'offline'}`;

            if (networkData) {
                card.innerHTML = `
                    <h3>
                        <span class="status-dot online"></span>
                        ${network.toUpperCase()}
                    </h3>
                    <div class="network-stats">
                        <div><strong>Block:</strong> ${networkData.blocks.toLocaleString()}</div>
                        <div><strong>Difficulty:</strong> ${this.formatNumber(networkData.difficulty)}</div>
                        <div><strong>Size:</strong> ${this.formatBytes(networkData.size_on_disk)}</div>
                    </div>
                `;
            } else {
                card.innerHTML = `
                    <h3>
                        <span class="status-dot offline"></span>
                        ${network.toUpperCase()}
                    </h3>
                    <div class="network-stats">
                        <div class="offline-text">Offline</div>
                    </div>
                `;
            }

            container.appendChild(card);
        });
    }

    displayNetworkError() {
        const container = document.getElementById('networkStatus');
        container.innerHTML = '<div class="error">Failed to load network status. Please try again later.</div>';
    }

    async loadRates() {
        try {
            const response = await fetch(`${this.apiBase}/invoice/rates`);
            const data = await response.json();
            this.rates = data;
        } catch (error) {
            console.error('Failed to load rates:', error);
            this.rates = {};
        }
    }

    async performSearch() {
        const searchInput = document.getElementById('searchInput');
        const query = searchInput.value.trim();
        
        if (!query) return;

        try {
            if (/^[a-fA-F0-9]{64}$/.test(query)) {
                const isTransaction = await this.checkIfTransaction(query);
                if (isTransaction) {
                    await this.showTransaction(query);
                    return;
                } else {
                    await this.searchBlockHash(query);
                    return;
                }
            }
            
            if (this.isValidAddress(query)) {
                await this.showAddress(query);
                return;
            }
            
            throw new Error('Invalid search format. Please enter a valid address, transaction ID, or block hash.');
        } catch (error) {
            alert(error.message);
        }
    }

    async checkIfTransaction(txid) {
        for (const network of this.networks) {
            try {
                const response = await fetch(`${this.apiBase}/rpc/${network}/txid/${txid}`);
                const data = await response.json();
                if (!data.error) {
                    return true;
                }
            } catch (e) {
                continue;
            }
        }
        
        try {
            const response = await fetch(`${this.apiBase}/txid/${txid}`);
            const data = await response.json();
            if (!data.error) {
                return true;
            }
        } catch (e) {}
        
        return false;
    }

    async searchBlockHash(hash) {
        for (const network of this.networks) {
            try {
                const response = await fetch(`${this.apiBase}/rpc/${network}/block/${hash}`);
                const data = await response.json();
                if (!data.error) {
                    await this.showBlock(hash, network);
                    return;
                }
            } catch (e) {
                continue;
            }
        }
        this.show404();
    }

    async showTransaction(txid, knownNetwork = null) {
        this.updateHash('tx', txid);
        this.currentPage = 'transaction';
        this.showPage('transactionPage');
        this.updateTitle(`Transaction ${txid.substring(0, 8)}... - Transaction.st`);
        
        const container = document.getElementById('transactionContent');
        container.innerHTML = '<div class="loading">Loading transaction...</div>';

        try {
            let rpcData = null;
            let dbData = null;
            let network = knownNetwork;
            
            if (knownNetwork) {
                try {
                    const response = await fetch(`${this.apiBase}/rpc/${knownNetwork}/txid/${txid}`);
                    const data = await response.json();
                    if (!data.error) {
                        rpcData = { type: 'rpc', data, network: knownNetwork };
                    }
                } catch (e) {}
            }
            
            if (!rpcData) {
                for (const net of this.networks) {
                    if (net === knownNetwork) continue;
                    try {
                        const response = await fetch(`${this.apiBase}/rpc/${net}/txid/${txid}`);
                        const data = await response.json();
                        if (!data.error) {
                            rpcData = { type: 'rpc', data, network: net };
                            network = net;
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            try {
                const response = await fetch(`${this.apiBase}/txid/${txid}`);
                const data = await response.json();
                if (!data.error) {
                    dbData = { type: 'database', data };
                }
            } catch (e) {}

            if (!rpcData && !dbData) {
                this.show404();
                return;
            }
            this.displayTransaction(rpcData || dbData, container, dbData);
        } catch (error) {
            this.show404();
        }
    }

    displayTransaction(txData, container, dbData = null) {
        if (txData.type === 'rpc') {
            this.displayRpcTransaction(txData.data, txData.network, container, dbData);
        } else {
            this.displayDatabaseTransaction(txData.data, container);
        }
    }

    displayDatabaseTransaction(data, container) {
        const transactions = Array.isArray(data) ? data : [data];
        let html = '';
        
        transactions.forEach((tx, index) => {
            html += `
                <div class="detail-card">
                    <h3>Transaction Output ${index}</h3>
                    <div class="detail-row">
                        <span class="detail-label">TXID:</span>
                        <span class="detail-value hash">${tx.txid}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Address:</span>
                        <span class="detail-value"><a class="address-link" onclick="showAddress('${tx.address}')">${tx.address}</a></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Amount:</span>
                        <span class="detail-value">${this.formatAmountWithUSD(tx.amount, tx.crypto)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Amount (Satoshis):</span>
                        <span class="detail-value">${tx.amount_sat.toLocaleString()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Block:</span>
                        <span class="detail-value">
                            ${tx.block ? `<a class="block-link" onclick="showBlockByHash('${tx.block}', '${tx.crypto}')">${tx.block}</a>` : 'Unconfirmed'}
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Network:</span>
                        <span class="detail-value">${tx.crypto.toUpperCase()}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Output Index:</span>
                        <span class="detail-value">${tx.vout}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Script:</span>
                        <span class="detail-value hash">${tx.scriptPubKey}</span>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    }

    displayRpcTransaction(data, network, container, dbData = null) {
        const tx = data.tx;
        let html = `
            <div class="detail-card">
                <h3>Transaction Summary</h3>
                <div class="detail-row">
                    <span class="detail-label">Hash:</span>
                    <span class="detail-value">${tx.hash}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Block:</span>
                    <span class="detail-value">
                        ${tx.block ? `<a class="block-link" onclick="showBlockByHash('${tx.block}', '${network}')">${tx.block}</a>` : 'N/A'}
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Network:</span>
                    <span class="detail-value">${network.toUpperCase()}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Size:</span>
                    <span class="detail-value">${tx.size} bytes</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Fee:</span>
                    <span class="detail-value">${this.formatAmountWithUSD(tx.fee, network)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Fee Rate:</span>
                    <span class="detail-value">${this.calculateFeeRate(tx.fee, tx.size, network)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Version:</span>
                    <span class="detail-value">${tx.version}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Lock Time:</span>
                    <span class="detail-value">${tx.lock}</span>
                </div>
            </div>
        `;

        const inputs = data.in || [];
        const outputs = data.out || [];
        
        html += `
            <div class="inputs-outputs">
                <div>
                    <h3>Inputs${inputs.length > 0 ? ` (${inputs.length})` : ''}</h3>
                    ${inputs.length > 0 ? inputs.map(input => {
                        const isCoinbase = input.hasOwnProperty('coinbase');
                        
                        if (isCoinbase) {
                            return `
                                <div class="input-item">
                                    <div class="io-amount">Coinbase (Block Reward)</div>
                                    <div class="coinbase-data">
                                        Coinbase data: ${input.coinbase}
                                    </div>
                                    <div class="text-xs text-muted">
                                        New coins minted for mining this block
                                    </div>
                                </div>
                            `;
                        } else {
                            return `
                                <div class="input-item">
                                    <div class="io-amount">${this.formatAmountWithUSD(input.value, network)}</div>
                                    <div class="io-address" onclick="showAddress('${input.address}')">${input.address || 'N/A'}</div>
                                    <div class="text-xs text-muted">
                                        From: <span class="hash" onclick="showTransaction('${input.txid}', '${network}')">${input.txid}:${input.vout}</span>
                                    </div>
                                </div>
                            `;
                        }
                    }).join('') : '<div class="input-item" class="text-muted">No inputs</div>'}
                </div>
                <div>
                    <h3>Outputs${outputs.length > 0 ? ` (${outputs.length})` : ''}</h3>
                    ${outputs.length > 0 ? outputs.map((output, index) => `
                        <div class="output-item">
                            <div class="io-amount">${this.formatAmountWithUSD(output.value, network)}</div>
                            ${output.script.address ? 
                                `<div class="io-address" onclick="showAddress('${output.script.address}')">${output.script.address}</div>` :
                                `<div class="coinbase-data" class="text-muted">${output.script.asm || 'N/A'}</div>`
                            }
                            <div class="text-xs text-muted">
                                Output #${index} (${output.script.type})
                            </div>
                        </div>
                    `).join('') : '<div class="output-item" class="text-muted">No outputs</div>'}
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }

    async showAddress(address) {
        this.updateHash('address', address);
        this.currentPage = 'address';
        this.showPage('addressPage');
        this.updateTitle(`Address ${address.substring(0, 8)}... - Transaction.st`);
        
        const container = document.getElementById('addressContent');
        container.innerHTML = '<div class="loading">Loading address...</div>';

        try {
            const response = await fetch(`${this.apiBase}/address/${address}`);
            const data = await response.json();
            
            if (data.error) {
                this.show404();
                return;
            }
            
            this.displayAddress(data, container);
        } catch (error) {
            this.show404();
        }
    }

    displayAddress(data, container) {
        const network = data.transactions.length > 0 ? data.transactions[0].crypto : 'btc';
        
        const html = `
            <div class="balance-summary">
                <h3>Address: ${data.address}</h3>
                <div class="balance-item">
                    <span>Total Received:</span>
                    <span>${this.formatAmountWithUSD(data.received, network)}</span>
                </div>
                <div class="balance-item">
                    <span>Confirmed Balance:</span>
                    <span>${this.formatAmountWithUSD(data.confirmed, network)}</span>
                </div>
                <div class="balance-item">
                    <span>Unconfirmed:</span>
                    <span>${this.formatAmountWithUSD((data.received - data.confirmed).toFixed(8), network)}</span>
                </div>
                <div class="balance-item">
                    <span>Total Transactions:</span>
                    <span>${data.transactions.length}</span>
                </div>
            </div>
            
            <div class="detail-card">
                <h3>Transaction History</h3>
                <div class="tx-list">
                    ${data.transactions.map(tx => `
                        <div class="tx-in-block" onclick="showTransaction('${tx.txid}', '${tx.crypto}')">
                            <div class="flex-between">
                                <div>
                                    <div class="text-bold">${this.formatAmountWithUSD(tx.amount, tx.crypto)}</div>
                                    <div class="text-small text-muted">
                                        ${tx.block ? 'Confirmed' : 'Unconfirmed'}
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="tx-hash">${tx.txid}</div>
                                    <div class="text-small text-muted">
                                        ${tx.block ? `Block: <span class="hash">${tx.block}</span>` : 'Pending'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }

    async showBlock(hash, network) {
        this.updateHash('block', hash);
        this.currentPage = 'block';
        this.showPage('blockPage');
        this.updateTitle(`Block ${hash.substring(0, 8)}... - Transaction.st`);
        
        const container = document.getElementById('blockContent');
        container.innerHTML = '<div class="loading">Loading block...</div>';

        try {
            const response = await fetch(`${this.apiBase}/rpc/${network}/block/${hash}`);
            const data = await response.json();
            
            if (data.error) {
                this.show404();
                return;
            }
            
            this.displayBlock(data, network, container);
        } catch (error) {
            this.show404();
        }
    }

    displayBlock(data, network, container) {
        const html = `
            <div class="detail-card">
                <h3>Block Information</h3>
                <div class="detail-row">
                    <span class="detail-label">Hash:</span>
                    <span class="detail-value">${data.hash}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Height:</span>
                    <span class="detail-value">${data.height?.toLocaleString() || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Network:</span>
                    <span class="detail-value">${network.toUpperCase()}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Time:</span>
                    <span class="detail-value">${new Date(data.time * 1000).toLocaleString()}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Transactions:</span>
                    <span class="detail-value">${data.nTx || data.tx?.length || 0}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Size:</span>
                    <span class="detail-value">${data.size} bytes</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Difficulty:</span>
                    <span class="detail-value">${this.formatNumber(data.difficulty)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Nonce:</span>
                    <span class="detail-value">${data.nonce}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Merkle Root:</span>
                    <span class="detail-value">${data.merkleroot}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Previous Block:</span>
                    <span class="detail-value">
                        ${data.previousblockhash ? 
                            `<a class="block-link" onclick="showBlockByHash('${data.previousblockhash}', '${network}')">${data.previousblockhash}</a>` : 
                            'Genesis Block'
                        }
                    </span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Next Block:</span>
                    <span class="detail-value">
                        ${data.nextblockhash ? 
                            `<a class="block-link" onclick="showBlockByHash('${data.nextblockhash}', '${network}')">${data.nextblockhash}</a>` : 
                            'Latest Block'
                        }
                    </span>
                </div>
            </div>
        `;

        if (data.tx && data.tx.length > 0) {
            const initialTxList = `
                <div class="detail-card">
                    <h3>Transactions (${data.tx.length})</h3>
                    <div class="tx-list" id="blockTxList">
                        ${data.tx.map((txid, index) => `
                            <div class="tx-in-block" onclick="showTransaction('${txid}', '${network}')" id="tx-${txid}">
                                <div>
                                    <div class="flex-center">
                                        <span>#${index} </span>
                                        <span class="text-bold text-primary">Unknown</span>
                                    </div>
                                    <div class="hash">${txid}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            container.innerHTML = html + initialTxList;
            this.loadBlockTransactionDetails(data.tx, network);
        } else {
            container.innerHTML = html;
        }
    }

    async loadBlockTransactionDetails(txids, network) {
        try {
            const response = await fetch(`${this.apiBase}/txid`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    terms: txids
                })
            });
            
            const txData = await response.json();
            
            if (txData.error) {
                throw new Error('Failed to load transaction details');
            }

            txids.forEach((txid, index) => {
                const txElement = document.getElementById(`tx-${txid}`);
                if (!txElement) return;

                const txDetails = txData[txid];
                if (txDetails && txDetails.length > 0) {
                    const totalAmount = txDetails.reduce((sum, output) => sum + output.amount, 0);
                    const outputCount = txDetails.length;
                    const crypto = txDetails[0].crypto;
                    
                    txElement.innerHTML = `
                        <div class="flex-between">
                            <div>
                                <div class="flex-center">
                                    <span>#${index} </span>
                                    <span class="text-bold text-primary">${this.formatAmountWithUSD(totalAmount, crypto)}</span>
                                    <span class="text-xs text-muted">${outputCount} output${outputCount !== 1 ? 's' : ''}</span>
                                </div>
                                <div class="hash">${txid}</div>
                            </div>
                        </div>
                    `;
                }
            });

        } catch (error) {
            console.error('Failed to load transaction details:', error);
        }
    }

    connectToSocket() {
        try {
            this.eventSource = new EventSource(this.socketUrl);
            
            this.eventSource.onopen = () => {
                this.updateLatestTransactions('Connected to live feed');
            };

            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleSocketMessage(data);
                } catch (e) {}
            };

            this.eventSource.onerror = () => {};
        } catch (error) {
            console.error('Failed to connect to socket:', error);
        }
    }

    handleSocketMessage(data) {
        if (data.type === 'tx' && data.data && data.data.tx) {
            const totalAmount = data.data.out ? data.data.out.reduce((sum, output) => sum + output.value, 0) : 0;
            
            const tx = {
                txid: data.data.tx.hash,
                amount: totalAmount,
                crypto: data.crypto,
                block: data.data.tx.block,
                time: data.time,
                inputs: data.data.in ? data.data.in.length : 0,
                outputs: data.data.out ? data.data.out.length : 0
            };
            
            this.latestTransactions.unshift(tx);
            if (this.latestTransactions.length > 5) {
                this.latestTransactions.pop();
            }
            this.updateLatestTransactions();
        } else if (data.type === 'block' && data.data) {
            const block = {
                hash: data.data.hash,
                height: data.data.height,
                crypto: data.crypto,
                time: data.data.time,
                mediantime: data.data.mediantime,
                nTx: data.data.nTx || data.data.tx?.length || 0,
                timestamp: data.data.time || data.data.mediantime || 0
            };
            
            this.latestBlocks.unshift(block);
            if (this.latestBlocks.length > 5) {
                this.latestBlocks.pop();
            }
            this.updateLatestBlocks();
        }
    }

    updateLatestBlocks() {
        const container = document.getElementById('latestBlocks');
        const allBlocks = [...this.latestBlocks];
        
        for (const network of this.networks) {
            if (this.networkInfo[network]) {
                const networkData = this.networkInfo[network];
                allBlocks.push({
                    hash: networkData.bestblockhash,
                    height: networkData.blocks,
                    crypto: network,
                    time: networkData.time,
                    timestamp: networkData.time || networkData.mediantime || 0
                });
            }
        }
        
        allBlocks.sort((a, b) => b.timestamp - a.timestamp);
        
        const html = allBlocks.slice(0, 5).map(block => `
            <div class="list-item block-item" onclick="showBlockByHash('${block.hash}', '${block.crypto}')">
                <div class="block-summary">
                    <span class="block-height">${block.crypto.toUpperCase()} #${block.height.toLocaleString()}</span>
                    <span class="block-time">${block.time ? this.formatBlockTime(block.time) : ''}</span>
                </div>
                <div class="block-hash">${block.hash}</div>
            </div>
        `).join('');
        
        container.innerHTML = html;
    }

    updateLatestTransactions(message = null) {
        const container = document.getElementById('latestTransactions');
        
        if (message) {
            container.innerHTML = `<div class="list-item loading">${message}</div>`;
            return;
        }

        if (this.latestTransactions.length === 0) {
            container.innerHTML = '<div class="list-item loading">Waiting for transactions...</div>';
            return;
        }

        const html = this.latestTransactions.map(tx => `
            <div class="list-item transaction-item" onclick="showTransaction('${tx.txid}', '${tx.crypto}')">
                <div class="tx-summary">
                    <span class="tx-network">${tx.crypto.toUpperCase()}</span>
                    <span class="tx-amount">${this.formatAmountWithUSD(tx.amount, tx.crypto)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem;">
                    <div class="tx-hash" style="flex: 1;">${tx.txid}</div>
                    <div class="text-small text-muted" style="margin-left: 0.75rem;">
                        ${tx.inputs}→${tx.outputs} • ${tx.block ? 'Confirmed' : 'Unconfirmed'}
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }

    showPage(pageId) {
        const pages = ['homePage', 'transactionPage', 'addressPage', 'blockPage', 'notFoundPage'];
        pages.forEach(page => {
            document.getElementById(page).style.display = 'none';
        });
        document.getElementById(pageId).style.display = 'block';
    }

    show404() {
        this.currentPage = 'notFound';
        this.showPage('notFoundPage');
        this.updateTitle('Page Not Found - Transaction.st');
    }

    showHome() {
        window.history.pushState(null, '', window.location.pathname);
        this.currentPage = 'home';
        this.showPage('homePage');
        this.updateTitle('Transaction.st - Block Explorer');
    }

    updateTitle(title) {
        document.title = title;
    }

    isValidAddress(address) {
        const patterns = [
            /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/,
            /^bc1[a-z0-9]{39,59}$/,
            /^[LM][a-km-zA-HJ-NP-Z1-9]{26,33}$/,
            /^D[5-9A-HJ-NP-U][1-9A-HJ-NP-Za-km-z]{32}$/,
            /^X[1-9A-HJ-NP-Za-km-z]{33}$/,
            /^(bitcoincash:)?[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{42}$/
        ];
        
        return patterns.some(pattern => pattern.test(address));
    }

    formatNumber(num) {
        if (!num) return 'N/A';
        return new Intl.NumberFormat().format(Math.round(num));
    }

    formatBytes(bytes) {
        if (!bytes) return 'N/A';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    calculateFeeRate(fee, size, network) {
        const feeInSmallestUnit = parseFloat(fee) * 100000000;
        
        if (network.toLowerCase() === 'doge') {
            const feeRate = (parseFloat(fee) / size * 1000).toFixed(2);
            return `${feeRate} DOGE/KB`;
        } else {
            const feeRate = (feeInSmallestUnit / size).toFixed(2).replace(/\.?0+$/, '');
            const unit = network.toLowerCase() === 'ltc' ? 'lit/byte' : network.toLowerCase() === 'dash' ? 'duffs/byte' : 'sats/byte';
            return `${feeRate} ${unit}`;
        }
    }

    formatBlockTime(timestamp) {
        if (!timestamp) return '';
        
        const blockTime = new Date(timestamp * 1000);
        return blockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    formatAmountWithUSD(amount, network) {
        const rate = this.rates[network.toLowerCase()];
        const formattedAmount = parseFloat(amount).toFixed(8).replace(/\.?0+$/, '');
        
        if (!rate || !amount || amount === 0) {
            return `${formattedAmount} ${network.toUpperCase()}`;
        }
        
        const usdValue = (parseFloat(amount) * rate).toFixed(2);
        const formattedUSD = new Intl.NumberFormat('en-US').format(usdValue);
        return `${formattedAmount} ${network.toUpperCase()} <span class="usd-value">($${formattedUSD})</span>`;
    }
}

let explorer;

function showHome() {
    window.history.pushState(null, '', window.location.pathname);
    explorer.currentPage = 'home';
    explorer.showPage('homePage');
    explorer.updateTitle('Transaction.st - Block Explorer');
}

function showTransaction(txid, network = null) {
    explorer.showTransaction(txid, network);
}

function showAddress(address) {
    explorer.showAddress(address);
}

function showBlockByHash(hash, network) {
    explorer.showBlock(hash, network);
}

document.addEventListener('DOMContentLoaded', () => {
    explorer = new BlockExplorer();
});
