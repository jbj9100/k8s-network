document.addEventListener('DOMContentLoaded', function() {
    // Constants and elements
    const API_BASE_URL = '/api';
    const testForms = document.querySelectorAll('.test-form');
    const testButtons = document.querySelectorAll('.menu-item[data-test]');
    const statusBadge = document.getElementById('status-badge');
    const testTitle = document.getElementById('test-title');
    const resultsContainer = document.getElementById('results');
    
    // WebSocket connection for interactive sessions
    let webSocket = null;
    let commandWebSocket = null;
    
    // Command counter for real-time commands
    let commandCounter = 0;
    
    // Active command ID
    let activeCommandId = null;
    
    // Create abort controller for API requests
    let currentController = null;
    
    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel Test';
    cancelButton.className = 'btn-danger cancel-test-btn';
    cancelButton.style.display = 'none';
    cancelButton.addEventListener('click', cancelCurrentTest);
    
    // Add the cancel button to the page
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        const actionBar = document.createElement('div');
        actionBar.className = 'action-bar';
        actionBar.appendChild(cancelButton);
        
        // Insert it after the status badge
        const testHeader = document.querySelector('.test-header');
        if (testHeader) {
            testHeader.appendChild(actionBar);
        }
    }
    
    // Active test type
    let activeTestType = 'ping'; // Default is ping
    
    // Initialize test navigation
    testButtons.forEach(button => {
        button.addEventListener('click', function() {
            const testType = this.getAttribute('data-test');
            
            // Reset results only when test type changes
            if (testType !== activeTestType) {
                // Clear results container
                clearResults();
                
                // Update active test type
                activeTestType = testType;
            }
            
            // Update active class
            testButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Update title
            testTitle.textContent = this.textContent.trim();
            
            // Show correct form
            testForms.forEach(form => {
                form.classList.add('hidden');
            });
            
            // Check if form exists and display it
            const formElement = document.getElementById(`${testType}-form`);
            if (formElement) {
                formElement.classList.remove('hidden');
            } else {
                console.warn(`Form for test type "${testType}" not found`);
            }
            
            // Reset status
            setStatus('ready');
        });
    });
    
    // Clear results container function
    function clearResults() {
        if (resultsContainer) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.remove('realtime-active');
        }
    }
    
    // Initialize WebSocket for real-time commands
    function initCommandSocket() {
        if (commandWebSocket && 
            (commandWebSocket.readyState === WebSocket.OPEN || 
             commandWebSocket.readyState === WebSocket.CONNECTING)) {
            return Promise.resolve(commandWebSocket);
        }
        
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/ws`;
            
            console.log('WebSocket URL:', wsUrl);
            commandWebSocket = new WebSocket(wsUrl);
            
            commandWebSocket.onopen = function() {
                console.log('WebSocket connection successful');
                resolve(commandWebSocket);
            };
            
            commandWebSocket.onerror = function(error) {
                console.error('WebSocket connection error:', error);
                reject(error);
            };
            
            commandWebSocket.onmessage = function(event) {
                try {
                    const response = JSON.parse(event.data);
                    console.log('WebSocket response:', response);
                    
                    // Connection confirmation message
                    if (response.type === 'connected') {
                        console.log('WebSocket server connection status:', response.message);
                        return;
                    }
                    
                    // Echo test response
                    if (response.type === 'echo') {
                        console.log('Echo response:', response.data);
                        return;
                    }
                    
                    // Process output or error messages
                    if (response.type === 'output' || response.type === 'error') {
                        // Only process output for the active command
                        if (response.id === activeCommandId) {
                            const currentText = resultsContainer.innerHTML;
                            
                            // Replace if there's an "executing" message, otherwise append
                            if (currentText === '' || currentText.includes('Executing command...')) {
                                resultsContainer.innerHTML = `<pre>${response.data}</pre>`;
                            } else {
                                // Find existing pre tag and append
                                const preElement = resultsContainer.querySelector('pre');
                                if (preElement) {
                                    preElement.textContent += response.data;
                                    preElement.scrollTop = preElement.scrollHeight;
                                } else {
                                    resultsContainer.innerHTML += `<pre>${response.data}</pre>`;
                                }
                            }
                        }
                    } 
                    // Command completion handling
                    else if (response.type === 'complete') {
                        if (response.id === activeCommandId) {
                            setStatus(response.exitCode === 0 ? 'success' : 'failed');
                            cancelButton.style.display = 'none';
                            activeCommandId = null;
                        }
                    } 
                    // Command cancellation handling
                    else if (response.type === 'cancelled') {
                        if (response.id === activeCommandId) {
                            setStatus('ready');
                            displayResults('Command was canceled: ' + response.message, false);
                            cancelButton.style.display = 'none';
                            activeCommandId = null;
                        }
                    }
                } catch (error) {
                    console.error('WebSocket message parsing error:', error);
                }
            };
            
            commandWebSocket.onclose = function() {
                console.log('WebSocket connection closed');
                
                // Reset state if there was an active command
                if (activeCommandId) {
                    cancelButton.style.display = 'none';
                    activeCommandId = null;
                }
                
                commandWebSocket = null;
            };
        });
    }
    
    // Execute real-time command
    async function executeRealtimeCommand(cmd, args) {
        try {
            // WebSocket connection initialization
            await initCommandSocket();
            
            // Generate unique command ID
            commandCounter++;
            const commandId = `cmd_${Date.now()}_${commandCounter}`;
            activeCommandId = commandId;
            
            // Reset previous results and show execution status
            resultsContainer.innerHTML = '<div>Executing command...</div>';
            resultsContainer.classList.add('realtime-active');
            
            // Show cancel button
            cancelButton.style.display = 'inline-block';
            
            console.log(`Executing real-time command: ${cmd}`, args);
            
            // Send command
            commandWebSocket.send(JSON.stringify({
                type: 'command',
                id: commandId,
                cmd: cmd,
                args: args
            }));
            
            setStatus('running');
            return true;
        } catch (error) {
            console.error('WebSocket execution error:', error);
            displayResults('Real-time command execution failed. Trying API fallback...', true);
            return false;
        }
    }
    
    // Function to cancel current test
    function cancelCurrentTest() {
        // Cancel API requests
        if (currentController) {
            currentController.abort();
            currentController = null;
        }
        
        // Close WebSocket connections
        if (commandWebSocket && activeCommandId) {
            try {
                commandWebSocket.send(JSON.stringify({
                    type: 'cancel',
                    id: activeCommandId
                }));
            } catch (e) {
                console.error('Error sending cancel command:', e);
            }
        }
        
        // Reset UI
        cancelButton.style.display = 'none';
        setStatus('ready');
        displayResults('Test cancelled by user', true);
        
        // Reset variables
        activeCommandId = null;
    }
    
    // Update status function
    function setStatus(status) {
        statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusBadge.className = 'badge';
        
        switch(status.toLowerCase()) {
            case 'running':
                statusBadge.classList.add('badge-running');
                // Show cancel button when test is running
                cancelButton.style.display = 'inline-block';
                break;
            case 'failed':
                statusBadge.classList.add('badge-failed');
                // Hide cancel button on failure
                cancelButton.style.display = 'none';
                break;
            case 'success':
                statusBadge.classList.add('badge-completed');
                // Hide cancel button on success
                cancelButton.style.display = 'none';
                break;
            case 'ready':
            default:
                statusBadge.classList.add('badge-ready');
                // Hide cancel button when ready
                cancelButton.style.display = 'none';
                break;
        }
    }
    
    // Display results function
    function displayResults(data, isError = false) {
        let resultContent = '';
        
        if (isError) {
            resultContent = `<div class="result-error">Error: ${data}</div>`;
        } else if (typeof data === 'string') {
            resultContent = `<div class="result-success"><pre>${data}</pre></div>`;
        } else {
            resultContent = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
        }
        
        resultsContainer.innerHTML = resultContent;
    }
    
    // Format data as table if possible
    function formatAsTable(data) {
        if (!Array.isArray(data) || data.length === 0) {
            return JSON.stringify(data, null, 2);
        }
        
        try {
            const headers = Object.keys(data[0]);
            let tableHtml = '<table class="data-table">';
            
            // Table header
            tableHtml += '<thead><tr>';
            headers.forEach(header => {
                tableHtml += `<th>${header}</th>`;
            });
            tableHtml += '</tr></thead>';
            
            // Table body
            tableHtml += '<tbody>';
            data.forEach(row => {
                tableHtml += '<tr>';
                headers.forEach(header => {
                    const cellValue = row[header];
                    let displayValue;
                    
                    if (cellValue === null) {
                        displayValue = '<em>null</em>';
                    } else if (typeof cellValue === 'object') {
                        displayValue = JSON.stringify(cellValue);
                    } else {
                        displayValue = cellValue;
                    }
                    
                    tableHtml += `<td>${displayValue}</td>`;
                });
                tableHtml += '</tr>';
            });
            
            tableHtml += '</tbody></table>';
            return tableHtml;
        } catch (error) {
            console.error('Error formatting table:', error);
            return JSON.stringify(data, null, 2);
        }
    }
    
    // Display results as formatted table
    function displayResultsWithTable(data) {
        if (data && data.results && Array.isArray(data.results)) {
            const tableHtml = formatAsTable(data.results);
            resultsContainer.innerHTML = `
                <div class="result-success">
                    <div>${data.message || ''}</div>
                    <div class="table-wrapper mt-3">${tableHtml}</div>
                </div>
            `;
        } else {
            displayResults(data);
        }
    }
    
    // WebSocket message display
    function displayWebSocketMessage(messagesContainer, message, sent = false) {
        const messageElement = document.createElement('div');
        messageElement.className = sent ? 'text-end' : 'text-start';
        messageElement.innerHTML = `
            <span class="badge ${sent ? 'bg-primary' : 'bg-secondary'}">
                ${sent ? 'Sent' : 'Received'}
            </span>
            <pre>${message}</pre>
        `;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Make API request with cancelation support
    async function makeRequest(endpoint, data) {
        try {
            // Update status to running
            setStatus('running');
            
            // Create new AbortController for this request
            currentController = new AbortController();
            
            // Make the API request
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                signal: currentController.signal // Add abort signal
            });
            
            // Clear controller reference after request completes
            currentController = null;
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Request failed');
            }
            
            const result = await response.json();
            setStatus('success');
            return result;
        } catch (error) {
            // Don't show error if request was cancelled
            if (error.name === 'AbortError') {
                console.log('Request was cancelled');
                return { cancelled: true };
            }
            
            setStatus('failed');
            throw error;
        }
    }
    
    // Ping Test Form
    const pingSubmitBtn = document.getElementById('ping-submit');
    const pingHostInput = document.getElementById('ping-host');
    const pingCountInput = document.getElementById('ping-count');
    const pingRealtimeCheckbox = document.getElementById('ping-realtime');
    
    if (pingSubmitBtn) {
        pingSubmitBtn.addEventListener('click', async function() {
            const host = pingHostInput.value.trim();
            if (!host) {
                displayResults('Host is required', true);
                return;
            }
            
            const count = parseInt(pingCountInput.value) || 4;
            const useRealtime = pingRealtimeCheckbox && pingRealtimeCheckbox.checked;
            
            clearResults();
            
            try {
                if (useRealtime) {
                    // Execute command via WebSocket for real-time results
                    const success = await executeRealtimeCommand('ping', { host, count });
                    if (!success) {
                        // Use API as fallback if WebSocket fails
                        const result = await makeRequest('/ping', { host, count });
                        displayResults(result.result);
                    }
                } else {
                    // Standard API call
                    const result = await makeRequest('/ping', { host, count });
                    displayResults(result.result);
                }
            } catch (error) {
                displayResults(error.message, true);
            }
        });
    }
    
    // Traceroute test handler
    const tracerouteSubmitBtn = document.getElementById('traceroute-submit');
    const tracerouteHostInput = document.getElementById('traceroute-host');
    const tracerouteRealtimeCheckbox = document.getElementById('traceroute-realtime');
    
    if (tracerouteSubmitBtn) {
        tracerouteSubmitBtn.addEventListener('click', async function() {
            const host = tracerouteHostInput.value.trim();
            if (!host) {
                displayResults('Host is required', true);
                return;
            }
            
            const useRealtime = tracerouteRealtimeCheckbox && tracerouteRealtimeCheckbox.checked;
            
            clearResults();
            
            try {
                if (useRealtime) {
                    // Execute command via WebSocket for real-time results
                    const success = await executeRealtimeCommand('traceroute', { host });
                    if (!success) {
                        // Use API as fallback if WebSocket fails
                        const result = await makeRequest('/traceroute', { host });
                        displayResults(result.result);
                    }
                } else {
                    // Standard API call
                    const result = await makeRequest('/traceroute', { host });
                    displayResults(result.result);
                }
            } catch (error) {
                displayResults(error.message, true);
            }
        });
    }
    
    // DNS Lookup 테스트
    document.getElementById('nslookup-submit').addEventListener('click', async function() {
        const host = document.getElementById('nslookup-host').value;
        const type = document.getElementById('nslookup-type').value;
        const dnsServer = document.getElementById('dns-server').value.trim();
        
        if (!host) {
            displayResults('Hostname is required', true);
            return;
        }
        
        // Clear results area before starting test
        clearResults();
        
        setStatus('running');
        console.log(`DNS Lookup request: host=${host}, type=${type}, dnsServer=${dnsServer || 'container default DNS'}`);
        
        try {
            // 새로운 AbortController 생성
            currentController = new AbortController();
            
            const response = await fetch('/api/nslookup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    host: host, 
                    type: type, 
                    dnsServer: dnsServer 
                }),
                signal: currentController.signal
            });
            
            // Request completed, reset controller
            currentController = null;
            
            const data = await response.json();
            console.log("DNS lookup response:", data);
            
            if (data.success) {
                let resultHTML = `<h3>DNS Lookup Result: ${host}</h3>`;
                
                // Display DNS server information
                resultHTML += `<div class="result-item"><strong>DNS Server:</strong> ${data.dnsServer || 'Default system DNS'}</div>`;
                
                resultHTML += `<div class="result-item"><strong>IP Address:</strong> ${data.ipAddress || 'N/A'}</div>`;
                resultHTML += `<div class="result-item"><strong>IP Version:</strong> ${data.ipFamily || 'N/A'}</div>`;
                
                if (data.records && data.records.length > 0) {
                    resultHTML += `<h4>DNS Records</h4>`;
                    data.records.forEach(record => {
                        resultHTML += `<div class="result-item">`;
                        for (const [key, value] of Object.entries(record)) {
                            if (typeof value === 'object') {
                                resultHTML += `<div><strong>${key}:</strong> ${JSON.stringify(value)}</div>`;
                            } else {
                                resultHTML += `<div><strong>${key}:</strong> ${value}</div>`;
                            }
                        }
                        resultHTML += `</div>`;
                    });
                } else {
                    resultHTML += `<div class="result-item">No DNS records found or unable to retrieve.</div>`;
                }
                
                // Add raw output - use JSON.stringify if it's an object
                const rawOutput = typeof data.rawOutput === 'object' 
                    ? JSON.stringify(data.rawOutput, null, 2) 
                    : data.rawOutput || '';
                
                resultHTML += `<div class="raw-output"><h4>Raw Output</h4><pre>${rawOutput}</pre></div>`;
                
                displayResults(resultHTML, false);
                setStatus('success');
            } else {
                displayResults(`DNS lookup failed: ${data.error || 'Unknown error'}`, true);
                setStatus('failed');
            }
        } catch (error) {
            console.error("DNS lookup error:", error);
            displayResults(`Request failed: ${error.message}`, true);
            setStatus('failed');
        }
    });
    
    // UDP test handler
    document.getElementById('udp-submit')?.addEventListener('click', async function() {
        const host = document.getElementById('udp-host').value.trim();
        const port = document.getElementById('udp-port').value.trim();
        const data = document.getElementById('udp-data').value.trim();
        const timeout = document.getElementById('udp-timeout').value.trim();
        
        if (!host || !port) {
            displayResults('Host and port are required', true);
            return;
        }
        
        // Clear results area before starting test
        clearResults();
        
        try {
            setStatus('running');
            const result = await makeRequest('/udp', { 
                host, 
                port: parseInt(port), 
                data,
                timeout: parseInt(timeout) || 3000
            });
            
            displayResults(result.result || 'UDP test completed successfully');
            setStatus('success');
        } catch (error) {
            displayResults(error.message, true);
            setStatus('failed');
        }
    });
    
    // TCP Port Test handler
    document.getElementById('tcp-submit')?.addEventListener('click', async function() {
        const host = document.getElementById('tcp-host').value.trim();
        const port = document.getElementById('tcp-port').value.trim();
        
        if (!host || !port) {
            displayResults('Host and port are required', true);
            return;
        }
        
        // Clear results area before starting test
        clearResults();
        
        try {
            setStatus('running');
            const result = await makeRequest('/tcp', { host, port: parseInt(port) });
            
            if (result.success) {
                displayResults(`✅ ${result.message || 'TCP connection successful!'}`, false);
            } else {
                displayResults(`❌ ${result.error || 'TCP connection failed'}`, true);
            }
            
            setStatus(result.success ? 'success' : 'failed');
        } catch (error) {
            displayResults(`❌ ${error.message}`, true);
            setStatus('failed');
        }
    });
    
    // MySQL test
    document.getElementById('mysql-submit')?.addEventListener('click', function() {
        const host = document.getElementById('mysql-host').value;
        const port = document.getElementById('mysql-port').value;
        const user = document.getElementById('mysql-user').value;
        const password = document.getElementById('mysql-password').value;
        const database = document.getElementById('mysql-database').value;
        const query = document.getElementById('mysql-query').value;

        if (!host || !user) {
            displayResults('Host and Username are required fields', true);
            return;
        }

        // Clear results area
        clearResults();
        
        // If query exists, run query, otherwise test connection
        if (query.trim()) {
            makeRequest('/mysql/query', { host, port, user, password, database, query })
                .then(result => {
                    if (result.success) {
                        // Format results as table if possible
                        if (result.data && Array.isArray(result.data)) {
                            const tableHtml = formatAsTable(result.data);
                            resultsContainer.innerHTML = `
                                <div class="result-success">
                                    <div>${result.message || 'Query executed successfully'}</div>
                                    <div>Rows: ${result.rowCount || result.data.length}</div>
                                    <div class="table-wrapper mt-3">${tableHtml}</div>
                                </div>
                            `;
                        } else {
                            displayResults(result);
                        }
                    } else {
                        displayResults(result.error || 'Unknown error', true);
                    }
                })
                .catch(error => {
                    displayResults(error.message, true);
                });
        } else {
            makeRequest('/mysql', { host, port, user, password, database })
                .then(result => {
                    if (result.success) {
                        displayResults(`Connection successful to MySQL server at ${host}:${port || 3306}`);
                    } else {
                        displayResults(result.error || 'Connection failed', true);
                    }
                })
                .catch(error => {
                    displayResults(error.message, true);
                });
        }
    });

    // PostgreSQL test
    document.getElementById('postgres-submit')?.addEventListener('click', function() {
        const host = document.getElementById('postgres-host').value;
        const port = document.getElementById('postgres-port').value;
        const user = document.getElementById('postgres-user').value;
        const password = document.getElementById('postgres-password').value;
        const database = document.getElementById('postgres-database').value;
        const query = document.getElementById('postgres-query').value;

        if (!host || !user || !database) {
            displayResults('Host, Username, and Database are required fields', true);
            return;
        }

        // Clear results area
        clearResults();
        
        // If query exists, run query, otherwise test connection
        if (query.trim()) {
            makeRequest('/postgres/query', { host, port, user, password, database, query })
                .then(result => {
                    if (result.success) {
                        // Format results as table if possible
                        if (result.data && Array.isArray(result.data)) {
                            const tableHtml = formatAsTable(result.data);
                            resultsContainer.innerHTML = `
                                <div class="result-success">
                                    <div>${result.message || 'Query executed successfully'}</div>
                                    <div>Rows: ${result.rowCount}</div>
                                    <div class="table-wrapper mt-3">${tableHtml}</div>
                                </div>
                            `;
                        } else {
                            displayResults(result);
                        }
                    } else {
                        displayResults(result.error || 'Unknown error', true);
                    }
                })
                .catch(error => {
                    displayResults(error.message, true);
                });
        } else {
            makeRequest('/postgres', { host, port, user, password, database })
                .then(result => {
                    if (result.success) {
                        displayResults(`Connection successful to PostgreSQL server at ${host}:${port || 5432}`);
                    } else {
                        displayResults(result.error || 'Connection failed', true);
                    }
                })
                .catch(error => {
                    displayResults(error.message, true);
                });
        }
    });

    // MongoDB test
    document.getElementById('mongodb-submit')?.addEventListener('click', function() {
        const host = document.getElementById('mongodb-host').value;
        const port = document.getElementById('mongodb-port').value;
        const user = document.getElementById('mongodb-user').value;
        const password = document.getElementById('mongodb-password').value;
        const database = document.getElementById('mongodb-database').value;
        const collection = document.getElementById('mongodb-collection').value;
        
        if (!host) {
            displayResults('Host is a required field', true);
            return;
        }
        
        // Clear results area
        clearResults();

        // If collection is specified, run query
        if (collection.trim()) {
            const query = document.getElementById('mongodb-query').value;
            const projection = document.getElementById('mongodb-projection').value;
            const limit = document.getElementById('mongodb-limit').value;

            let queryObj, projectionObj;
            try {
                queryObj = query ? JSON.parse(query) : {};
                projectionObj = projection ? JSON.parse(projection) : {};
            } catch (e) {
                displayResults('Invalid JSON format: ' + e.message, true);
                return;
            }

            makeRequest('/mongodb/query', { 
                host, port, user, password, database, collection, 
                query: queryObj, 
                projection: projectionObj, 
                limit: parseInt(limit) 
            })
                .then(result => {
                    if (result.success) {
                        // Format results as table if possible
                        if (result.data && Array.isArray(result.data)) {
                            const tableHtml = formatAsTable(result.data);
                            resultsContainer.innerHTML = `
                                <div class="result-success">
                                    <div>${result.message || 'Query executed successfully'}</div>
                                    <div>Documents: ${result.count}</div>
                                    <div class="table-wrapper mt-3">${tableHtml}</div>
                                </div>
                            `;
                        } else {
                            displayResults(result);
                        }
                    } else {
                        displayResults(result.error || 'Unknown error', true);
                    }
                })
                .catch(error => {
                    displayResults(error.message, true);
                });
        } else {
            // Only test connection if no collection specified
            makeRequest('/mongodb', { host, port, user, password, database })
                .then(result => {
                    if (result.success) {
                        displayResults(`Connection successful to MongoDB server at ${host}:${port || 27017}`);
                    } else {
                        displayResults(result.error || 'Connection failed', true);
                    }
                })
                .catch(error => {
                    displayResults(error.message, true);
                });
        }
    });
    
    // Redis connection test
    document.getElementById('redis-submit')?.addEventListener('click', function() {
        const host = document.getElementById('redis-host').value;
        const port = document.getElementById('redis-port').value;
        const password = document.getElementById('redis-password').value;
        const db = document.getElementById('redis-db').value;
        
        if (!host) {
            displayResults('Host is a required field', true);
            return;
        }
        
        // Clear results area
        clearResults();

        makeRequest('/redis', { host, port, password, db })
            .then(result => {
                if (result.success) {
                    displayResults(`Connection successful to Redis server at ${host}:${port || 6379}`);
                } else {
                    displayResults(result.error || 'Connection failed', true);
                }
            })
            .catch(error => {
                displayResults(error.message, true);
            });
    });
    
    // RabbitMQ test handler
    document.getElementById('rabbitmq-submit').addEventListener('click', async function() {
        const host = document.getElementById('rabbitmq-host').value.trim();
        const port = document.getElementById('rabbitmq-port').value.trim();
        const user = document.getElementById('rabbitmq-user').value.trim();
        const password = document.getElementById('rabbitmq-password').value;
        const vhost = document.getElementById('rabbitmq-vhost').value.trim();
        
        if (!host) {
            displayResults('Host is required', true);
            return;
        }
        
        try {
            const result = await makeRequest('/rabbitmq', { host, port, user, password, vhost });
            displayResults(result);
        } catch (error) {
            displayResults(error.message, true);
        }
    });
    
    // SSL Certificate test handler
    document.getElementById('ssl-submit').addEventListener('click', async function() {
        const host = document.getElementById('ssl-host').value.trim();
        const port = document.getElementById('ssl-port').value.trim();
        
        if (!host) {
            displayResults('Host is required', true);
            return;
        }
        
        try {
            const result = await makeRequest('/ssl', { host, port });
            displayResults(result.result);
        } catch (error) {
            displayResults(error.message, true);
        }
    });
    
    // System Info handler
    document.getElementById('sysinfo-submit').addEventListener('click', async function() {
        try {
            const response = await fetch(`${API_BASE_URL}/sysinfo`);
            const result = await response.json();
            
            if (!response.ok) {
                setStatus('failed');
                throw new Error(result.error || 'Unknown error occurred');
            }
            
            setStatus('success');
            
            // Format the system info with readable sizes
            if (result.totalmem) {
                result.totalmem = formatBytes(result.totalmem);
            }
            if (result.freemem) {
                result.freemem = formatBytes(result.freemem);
            }
            
            displayResults(result);
        } catch (error) {
            setStatus('failed');
            displayResults(error.message, true);
        }
    });
    
    // Helper function to format bytes
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Sidebar menu item click event
    const sidebarItems = document.querySelectorAll('.sidebar-menu li, .menu-item');
    sidebarItems.forEach(item => {
        item.addEventListener('click', function() {
            // Get form ID from data attribute
            const testType = this.getAttribute('data-test');
            
            // Always clear results when changing tests
            clearResults();
            
            // Cancel any ongoing tests
            cancelCurrentTest();
            
            // Update active test type
            activeTestType = testType;
            
            // Hide all test forms
            const allForms = document.querySelectorAll('.test-form');
            allForms.forEach(form => form.classList.add('hidden'));
            
            // Check if test form exists
            const testForm = document.getElementById(`${testType}-form`);
            if (testForm) {
                testForm.classList.remove('hidden');
                // Update active menu item style
                sidebarItems.forEach(item => item.classList.remove('active'));
                this.classList.add('active');
                
                // Reset status
                setStatus('ready');
            } else {
                console.error(`Form not found: ${testType}-form`);
                displayResults(`Test form for "${testType}" was not found.`, true);
            }
        });
    });

    // HTTP API test handler
    document.getElementById('http-submit').addEventListener('click', async function() {
        const url = document.getElementById('http-url').value.trim();
        const method = document.getElementById('http-method').value;
        let headers = document.getElementById('http-headers').value.trim();
        let data = document.getElementById('http-data').value.trim();
        
        if (!url) {
            displayResults('URL is required', true);
            return;
        }
        
        // Clear results area
        clearResults();
        
        try {
            // Parse JSON if provided
            if (headers) {
                try {
                    headers = JSON.parse(headers);
                } catch (e) {
                    displayResults('Invalid JSON in headers field', true);
                    return;
                }
            }
            
            if (data) {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    displayResults('Invalid JSON in request body field', true);
                    return;
                }
            }
            
            const result = await makeRequest('/http', { url, method, headers, data });
            displayResults(result);
        } catch (error) {
            displayResults(error.message, true);
        }
    });

    // WebSocket test handlers
    const wsConnectBtn = document.getElementById('websocket-connect');
    const wsDisconnectBtn = document.getElementById('websocket-disconnect');
    const wsMessagePanel = document.getElementById('websocket-message-panel');
    const wsSendBtn = document.getElementById('websocket-send');
    const wsEchoTestBtn = document.getElementById('websocket-echo-test');
    const wsMessagesContainer = document.getElementById('websocket-messages');
    
    function setupWebSocket(url) {
        // Clean up any existing connection
        if (webSocket) {
            webSocket.close();
            webSocket = null;
        }
        
        try {
            webSocket = new WebSocket(url);
            
            // Show cancel button
            cancelButton.style.display = 'inline-block';
            
            webSocket.onopen = function() {
                if (wsConnectBtn) wsConnectBtn.classList.add('hidden');
                if (wsDisconnectBtn) wsDisconnectBtn.classList.remove('hidden');
                if (wsMessagePanel) wsMessagePanel.classList.remove('hidden');
                
                displayResults("✅ Connected to WebSocket server", false);
                
                if (wsMessagesContainer) {
                    wsMessagesContainer.innerHTML = '<div class="message-success">Connected to WebSocket server</div>';
                }
                setStatus('success');
            };
            
            webSocket.onmessage = function(event) {
                displayResults("📩 Message received: " + event.data, false);
                
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, event.data);
                }
            };
            
            webSocket.onclose = function() {
                if (wsConnectBtn) wsConnectBtn.classList.remove('hidden');
                if (wsDisconnectBtn) wsDisconnectBtn.classList.add('hidden');
                if (wsMessagePanel) wsMessagePanel.classList.add('hidden');
                
                // Hide cancel button
                cancelButton.style.display = 'none';
                
                displayResults("🔌 WebSocket connection closed", false);
                
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, 'Connection closed');
                }
                webSocket = null;
                setStatus('ready');
            };
            
            webSocket.onerror = function(error) {
                // Hide cancel button
                cancelButton.style.display = 'none';
                
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, `Error: ${error.message || 'Unknown error'}`);
                }
                displayResults(`❌ WebSocket error: ${error.message || 'Unknown error'}`, true);
                setStatus('failed');
            };
        } catch (error) {
            // Hide cancel button
            cancelButton.style.display = 'none';
            
            displayResults(error.message, true);
            setStatus('failed');
        }
    }
    
    // 요소가 존재하는 경우에만 이벤트 리스너 추가
    if (wsConnectBtn) {
        wsConnectBtn.addEventListener('click', function() {
            const url = document.getElementById('websocket-url').value.trim();
            
            if (!url) {
                displayResults('WebSocket URL is required', true);
                return;
            }
            
            setStatus('running');
            setupWebSocket(url);
        });
    }
    
    if (wsDisconnectBtn) {
        wsDisconnectBtn.addEventListener('click', function() {
            if (webSocket) {
                webSocket.close();
            }
        });
    }
    
    // Send WebSocket message
    if (wsSendBtn) {
        wsSendBtn.addEventListener('click', function() {
            if (!webSocket) {
                displayResults('Not connected to WebSocket server.', true);
                return;
            }
            
            const messageInput = document.getElementById('websocket-message');
            if (!messageInput) return;
            
            const message = messageInput.value;
            
            if (message) {
                webSocket.send(message);
                displayResults(`📤 Message sent: ${message}`, false);
                
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, message, true);
                }
                messageInput.value = '';
            }
        });
    }
    
    if (wsEchoTestBtn) {
        wsEchoTestBtn.addEventListener('click', function() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const echoUrl = `${protocol}//${window.location.host}/`;
            
            // URL 필드 업데이트
            const wsUrlInput = document.getElementById('websocket-url');
            if (wsUrlInput) {
                wsUrlInput.value = echoUrl;
            }
            
            // 연결 시작 상태로 설정
            setStatus('running');
            clearResults();
            displayResults("🔄 Connecting to Echo server...", false);
            
            // WebSocket 연결 설정
            setupWebSocket(echoUrl);
        });
    }

    // 취소 버튼 이벤트 리스너 설정
    document.getElementById('cancel-test').addEventListener('click', () => {
        cancelCurrentTest();
    });

    // curl 테스트 이벤트 리스너
    const curlForm = document.getElementById('curl-form');
    const curlUrlInput = document.getElementById('curl-url');
    const curlMethodSelect = document.getElementById('curl-method');
    const curlHeadersInput = document.getElementById('curl-headers');
    const curlDataInput = document.getElementById('curl-data');
    const curlOptionsInput = document.getElementById('curl-options');
    const curlSubmitBtn = document.getElementById('curl-submit');
    
    if (curlForm && curlSubmitBtn) {
        curlSubmitBtn.addEventListener('click', async function() {
            const url = curlUrlInput.value.trim();
            if (!url) {
                displayResults('URL is required', true);
                return;
            }
            
            try {
                // 헤더 JSON 파싱
                let headers = {};
                if (curlHeadersInput.value.trim()) {
                    try {
                        headers = JSON.parse(curlHeadersInput.value);
                    } catch (e) {
                        displayResults('Invalid JSON format for headers', true);
                        return;
                    }
                }
                
                // 요청 데이터 준비
                let data = curlDataInput.value.trim();
                if (data) {
                    try {
                        // Try parsing as JSON
                        data = JSON.parse(data);
                    } catch (e) {
                        // Use as-is if parsing fails
                        console.log('Body is not JSON, using as-is');
                    }
                }
                
                const options = curlOptionsInput.value.trim();
                
                clearResults();
                displayResults('Executing curl command...');
                
                // curl execution request
                const response = await fetch(`${API_BASE_URL}/curl`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url,
                        method: curlMethodSelect.value,
                        headers: headers,
                        data: data || null,
                        options: options
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    let output = '';
                    
                    // Display executed command
                    output += `<div class="curl-command">$ ${result.command}</div>`;
                    
                    // Display stderr if available (usually for verbose info)
                    if (result.stderr) {
                        output += `<div class="curl-stderr"><pre>${escapeHTML(result.stderr)}</pre></div>`;
                    }
                    
                    // stdout output
                    if (result.stdout) {
                        output += `<div class="curl-stdout"><pre>${escapeHTML(result.stdout)}</pre></div>`;
                    }
                    
                    displayResults(output);
                } else {
                    displayResults(result.error || 'Unknown error executing curl command', true);
                }
            } catch (error) {
                displayResults(error.message || 'Error executing curl command', true);
                console.error('Curl execution error:', error);
            }
        });
    }
    
    // displayResult 함수가 없는 경우 displayResults를 사용하도록 정의
    function displayResult(content, isError = false) {
        displayResults(content, isError);
    }

    // HTML 이스케이프 헬퍼 함수
    function escapeHTML(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // 모든 테스트 폼 숨기고 결과 초기화
    function hideAllForms() {
        document.querySelectorAll('.test-form').forEach(form => {
            form.classList.add('hidden');
        });
        clearResults();
    }

    // 테스트 메뉴 이벤트 리스너
    document.querySelectorAll('.menu-item').forEach(menuItem => {
        menuItem.addEventListener('click', function() {
            // 이전 선택 활성화 제거
            document.querySelectorAll('.menu-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // 현재 메뉴 활성화
            this.classList.add('active');
            
            // 전체 폼 숨기기
            hideAllForms();
            
            // 선택한 테스트 폼 표시
            const testType = this.getAttribute('data-test');
            const formElement = document.getElementById(`${testType}-form`);
            if (formElement) {
                formElement.classList.remove('hidden');
            }
            
            // 타이틀 업데이트
            updateTestTitle(this.textContent.trim());
        });
    });

    // Tab 기능 구현
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            const tabContainer = this.closest('.tabs').parentElement;
            
            // 탭 버튼 활성화 상태 업데이트
            tabContainer.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // 탭 콘텐츠 표시/숨김 처리
            tabContainer.querySelectorAll('.tab-content').forEach(content => {
                content.classList.add('hidden');
            });
            document.getElementById(`${tabId}-tab`).classList.remove('hidden');
        });
    });

    // k8s Service DNS test
    document.getElementById('k8s-nslookup-submit').addEventListener('click', async function() {
        const serviceName = document.getElementById('k8s-service-name').value;
        const namespace = document.getElementById('k8s-namespace').value;
        const clusterDomain = document.getElementById('k8s-cluster-domain').value;
        const dnsServer = document.getElementById('k8s-dns-server').value;
        
        if (!serviceName) {
            displayResults('Service name is required.', true);
            return;
        }
        
        // FQDN construction
        const fqdn = `${serviceName}.${namespace}.svc.${clusterDomain}`;
        setStatus('running');
        clearResults();
        
        try {
            const response = await fetch('/api/nslookup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    host: fqdn, 
                    type: 'A',
                    dnsServer: dnsServer // Add DNS server
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                let resultHTML = `<h3>DNS Lookup Result: ${fqdn}</h3>`;
                resultHTML += `<div class="result-item"><strong>IP Address:</strong> ${data.ipAddress || 'N/A'}</div>`;
                resultHTML += `<div class="result-item"><strong>IP Version:</strong> ${data.ipFamily || 'N/A'}</div>`;
                resultHTML += `<div class="result-item"><strong>DNS Server:</strong> ${data.dnsServer || 'Default system DNS'}</div>`;
                
                if (data.records && data.records.length > 0) {
                    resultHTML += `<h4>DNS Records</h4>`;
                    data.records.forEach(record => {
                        resultHTML += `<div class="result-item">`;
                        for (const [key, value] of Object.entries(record)) {
                            resultHTML += `<div><strong>${key}:</strong> ${typeof value === 'object' ? JSON.stringify(value) : value}</div>`;
                        }
                        resultHTML += `</div>`;
                    });
                } else {
                    resultHTML += `<div class="result-item">No DNS records found or unable to retrieve.</div>`;
                }
                
                displayResults(resultHTML);
                setStatus('success');
            } else {
                displayResults(`DNS lookup failed: ${data.error || 'Unknown error'}`, true);
                setStatus('failed');
            }
        } catch (error) {
            displayResults(`Request failed: ${error.message}`, true);
            setStatus('failed');
        }
    });

    // k8s service connection test
    document.getElementById('k8s-conn-submit').addEventListener('click', async function() {
        const serviceName = document.getElementById('k8s-service-name').value;
        const namespace = document.getElementById('k8s-namespace').value;
        const clusterDomain = document.getElementById('k8s-cluster-domain').value;
        const port = document.getElementById('k8s-port').value;
        const protocol = document.getElementById('k8s-protocol').value;
        const dnsServer = document.getElementById('k8s-dns-server').value;
        
        if (!serviceName || !port) {
            displayResults('Service name and port are required.', true);
            return;
        }
        
        // FQDN construction
        const fqdn = `${serviceName}.${namespace}.svc.${clusterDomain}`;
        setStatus('running');
        clearResults();
        
        try {
            // First lookup IP via DNS
            if (dnsServer) {
                setStatus('running');
                try {
                    const dnsResponse = await fetch('/api/nslookup', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ host: fqdn, type: 'A', dnsServer: dnsServer })
                    });
                    
                    const dnsData = await dnsResponse.json();
                    if (dnsResponse.ok && dnsData.ipAddress) {
                        displayResults(`Resolved ${fqdn} to ${dnsData.ipAddress}. Connecting...`);
                    }
                } catch (error) {
                    console.error('DNS lookup error:', error);
                    // Continue even if DNS lookup fails (will use system DNS)
                }
            }
            
            let response;
            if (protocol === 'TCP') {
                response = await fetch('/api/tcp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ host: fqdn, port: parseInt(port) })
                });
            } else { // UDP
                response = await fetch('/api/udp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ host: fqdn, port: parseInt(port) })
                });
            }
            
            const data = await response.json();
            
            if (data.success) {
                let resultHTML = `<h3>${protocol} Connection Test Result: ${fqdn}:${port}</h3>`;
                resultHTML += `<div class="result-item success"><strong>Status:</strong> Connection successful</div>`;
                if (data.result) {
                    resultHTML += `<div class="result-item"><strong>Details:</strong> ${data.result}</div>`;
                }
                if (data.response) {
                    resultHTML += `<div class="result-item"><strong>Response:</strong> ${data.response}</div>`;
                }
                displayResults(resultHTML);
                setStatus('success');
            } else {
                displayResults(`Connection failed: ${data.error || 'Unknown error'}`, true);
                setStatus('failed');
            }
        } catch (error) {
            displayResults(`Request failed: ${error.message}`, true);
            setStatus('failed');
        }
    });

    // k8s Pod communication test
    document.getElementById('k8s-pod-conn-submit').addEventListener('click', async function() {
        const podIP = document.getElementById('k8s-pod-ip').value;
        const port = document.getElementById('k8s-pod-port').value;
        const protocol = document.getElementById('k8s-pod-protocol').value;
        const dnsServer = document.getElementById('k8s-pod-dns-server').value;
        
        if (!podIP || !port) {
            displayResults('Pod IP and port are required.', true);
            return;
        }
        
        setStatus('running');
        clearResults();
        
        try {
            // DNS server related message (IP address but can be used for reverse lookups)
            if (dnsServer) {
                displayResults(`Using DNS server ${dnsServer} for reverse lookups...`);
            }
            
            let response;
            if (protocol === 'TCP') {
                response = await fetch('/api/tcp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ host: podIP, port: parseInt(port) })
                });
            } else { // UDP
                response = await fetch('/api/udp', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ host: podIP, port: parseInt(port) })
                });
            }
            
            const data = await response.json();
            
            if (data.success) {
                let resultHTML = `<h3>${protocol} Pod Communication Test Result: ${podIP}:${port}</h3>`;
                resultHTML += `<div class="result-item success"><strong>Status:</strong> Connection successful</div>`;
                if (data.result) {
                    resultHTML += `<div class="result-item"><strong>Details:</strong> ${data.result}</div>`;
                }
                displayResults(resultHTML);
                setStatus('success');
            } else {
                displayResults(`Connection failed: ${data.error || 'Unknown error'}`, true);
                setStatus('failed');
            }
        } catch (error) {
            displayResults(`Request failed: ${error.message}`, true);
            setStatus('failed');
        }
    });

    // k8s DB connection test
    document.getElementById('k8s-db-submit').addEventListener('click', async function() {
        const dbType = document.getElementById('k8s-db-type').value;
        const service = document.getElementById('k8s-db-service').value;
        const port = document.getElementById('k8s-db-port').value;
        const user = document.getElementById('k8s-db-user').value;
        const password = document.getElementById('k8s-db-password').value;
        const dbName = document.getElementById('k8s-db-name').value;
        const query = document.getElementById('k8s-db-query').value;
        const dnsServer = document.getElementById('k8s-db-dns-server').value;
        
        if (!service) {
            displayResults('Service name is required.', true);
            return;
        }
        
        setStatus('running');
        clearResults();
        
        // Perform DNS lookup first if DNS server is specified
        if (dnsServer) {
            try {
                const dnsResponse = await fetch('/api/nslookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ host: service, type: 'A', dnsServer: dnsServer })
                });
                
                const dnsData = await dnsResponse.json();
                if (dnsResponse.ok && dnsData.ipAddress) {
                    displayResults(`Resolved ${service} to ${dnsData.ipAddress}. Connecting to database...`);
                }
            } catch (error) {
                console.error('DNS lookup error:', error);
                // Continue even if DNS lookup fails
            }
        }
        
        let endpoint = `/api/${dbType}`;
        let payload = {
            host: service,
            port: parseInt(port) || getDefaultPort(dbType),
            user,
            password,
            database: dbName
        };
        
        // 쿼리가 있는 경우 쿼리 API 사용
        if (query && ['mysql', 'postgres', 'mongodb'].includes(dbType)) {
            endpoint += '/query';
            payload.query = query;
        }
        
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            const data = await response.json();
            
            if (data.success) {
                let resultHTML = `<h3>${dbType} Connection Test Result</h3>`;
                resultHTML += `<div class="result-item success"><strong>Status:</strong> Connection successful</div>`;
                
                if (data.message) {
                    resultHTML += `<div class="result-item"><strong>Message:</strong> ${data.message}</div>`;
                }
                
                if (query && data.data) {
                    resultHTML += `<h4>Query Result</h4>`;
                    
                    if (Array.isArray(data.data) && data.data.length > 0) {
                        // 테이블 형식으로 표시
                        resultHTML += createTableFromData(data.data);
                    } else {
                        resultHTML += `<div class="result-item"><pre>${JSON.stringify(data.data, null, 2)}</pre></div>`;
                    }
                }
                
                displayResults(resultHTML);
                setStatus('success');
            } else {
                displayResults(`Connection failed: ${data.error || 'Unknown error'}`, true);
                setStatus('failed');
            }
        } catch (error) {
            displayResults(`Request failed: ${error.message}`, true);
            setStatus('failed');
        }
    });

    // DB 타입별 기본 포트 반환
    function getDefaultPort(dbType) {
        switch(dbType) {
            case 'mysql':
                return 3306;
            case 'postgres':
                return 5432;
            case 'mongodb':
                return 27017;
            case 'redis':
                return 6379;
            default:
                return 0;
        }
    }

    // 데이터로부터 HTML 테이블을 생성하는 함수
    function createTableFromData(data) {
        if (!Array.isArray(data) || data.length === 0) {
            return '<div class="result-item">No data available</div>';
        }
        
        let html = `<div class="table-responsive"><table class="result-table">`;
        
        // Table header
        html += '<thead><tr>';
        const headers = Object.keys(data[0]);
        headers.forEach(header => {
            html += `<th>${header}</th>`;
        });
        html += '</tr></thead>';
        
        // Table content
        html += '<tbody>';
        data.forEach(row => {
            html += '<tr>';
            Object.values(row).forEach(value => {
                if (value === null) {
                    html += '<td>null</td>';
                } else if (typeof value === 'object') {
                    html += `<td>${JSON.stringify(value)}</td>`;
                } else {
                    html += `<td>${value}</td>`;
                }
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        
        return html;
    }
}); 