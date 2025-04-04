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
    
    // Active test type
    let activeTestType = 'ping'; // 기본값은 ping
    
    // Initialize test navigation
    testButtons.forEach(button => {
        button.addEventListener('click', function() {
            const testType = this.getAttribute('data-test');
            
            // 테스트 타입이 변경될 때만 결과 초기화
            if (testType !== activeTestType) {
                // 결과 컨테이너 초기화
                clearResults();
                
                // 활성 테스트 타입 업데이트
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
            
            // 해당 테스트 폼이 존재하는지 확인 후 표시
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
    
    // 결과 컨테이너 초기화 함수
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
            const wsUrl = `${protocol}//${window.location.host}`;
            
            commandWebSocket = new WebSocket(wsUrl);
            
            commandWebSocket.onopen = function() {
                resolve(commandWebSocket);
            };
            
            commandWebSocket.onerror = function(error) {
                reject(error);
            };
            
            commandWebSocket.onmessage = function(event) {
                try {
                    const response = JSON.parse(event.data);
                    
                    if (response.type === 'output' || response.type === 'error') {
                        // Only process if this is for the active command
                        if (response.id === activeCommandId) {
                            const currentText = resultsContainer.innerHTML;
                            // Append new output
                            if (currentText === '' || currentText.includes('명령어 실행 중...')) {
                                resultsContainer.innerHTML = `<pre>${response.data}</pre>`;
                            } else {
                                // Extract existing content from pre tag
                                const preElement = resultsContainer.querySelector('pre');
                                if (preElement) {
                                    preElement.textContent += response.data;
                                    // Scroll to bottom
                                    preElement.scrollTop = preElement.scrollHeight;
                                } else {
                                    resultsContainer.innerHTML += `<pre>${response.data}</pre>`;
                                }
                            }
                        }
                    } else if (response.type === 'complete') {
                        // Command completed
                        if (response.id === activeCommandId) {
                            setStatus(response.exitCode === 0 ? 'success' : 'failed');
                        }
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };
            
            commandWebSocket.onclose = function() {
                commandWebSocket = null;
            };
        });
    }
    
    // Execute real-time command
    async function executeRealtimeCommand(cmd, args) {
        try {
            // Initialize WebSocket if needed
            await initCommandSocket();
            
            // Generate unique command ID
            commandCounter++;
            const commandId = `cmd_${Date.now()}_${commandCounter}`;
            activeCommandId = commandId;
            
            // Clear previous results and add realtime indicator
            resultsContainer.innerHTML = '<div>명령어 실행 중...</div>';
            resultsContainer.classList.add('realtime-active');
            
            // Send command
            commandWebSocket.send(JSON.stringify({
                type: 'command',
                id: commandId,
                cmd,
                args
            }));
            
            setStatus('running');
            return true;
        } catch (error) {
            console.error('WebSocket error:', error);
            displayResult('실시간 명령 실행에 실패했습니다. API를 통해 시도합니다.', 'error');
            return false;
        }
    }
    
    // Status update function
    function setStatus(status) {
        statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        statusBadge.className = 'badge';
        
        switch(status) {
            case 'ready':
                statusBadge.classList.add('bg-secondary');
                break;
            case 'running':
                statusBadge.classList.add('bg-warning');
                break;
            case 'success':
                statusBadge.classList.add('bg-success');
                break;
            case 'failed':
                statusBadge.classList.add('bg-danger');
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
    
    // 웹소켓 메시지 표시
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
    
    // API request function
    async function makeRequest(endpoint, data) {
        setStatus('running');
        
        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
            
            // 응답이 JSON이 아닌 경우 처리
            let result;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                try {
                    result = await response.json();
                } catch (error) {
                    console.error('JSON 파싱 오류:', error);
                    setStatus('failed');
                    throw new Error('서버 응답을 파싱할 수 없습니다. 응답이 유효한 JSON 형식이 아닙니다.');
                }
            } else {
                // JSON이 아닌 경우 텍스트로 처리
                const text = await response.text();
                result = { result: text };
            }
            
            if (!response.ok) {
                setStatus('failed');
                throw new Error(result.error || `요청 실패: ${response.status} ${response.statusText}`);
            }
            
            setStatus('success');
            return result;
        } catch (error) {
            console.error('API 요청 오류:', error);
            setStatus('failed');
            throw error;
        }
    }
    
    // Ping Test Form
    document.getElementById('ping-submit')?.addEventListener('click', async function() {
        const host = document.getElementById('ping-host').value;
        const count = document.getElementById('ping-count').value;
        const realtime = document.getElementById('ping-realtime').checked;
        
        if (!host) {
            displayResults('Host is required', true);
            return;
        }

        // 테스트 시작 전 결과 영역 초기화
        clearResults();

        if (realtime) {
            // Real-time ping using WebSocket
            const success = await executeRealtimeCommand('ping', { host, count });
            if (!success) {
                displayResults('WebSocket 연결 실패, API를 통해 시도합니다...', true);
                // Fall back to API approach
                pingViaApi(host, count);
            }
        } else {
            // Use API approach
            pingViaApi(host, count);
        }
    });
    
    // Ping via API
    async function pingViaApi(host, count) {
        try {
            setStatus('running');
            
            try {
                const response = await makeRequest('/api/ping', { host, count });
                
                // 구조화된 데이터가 있으면 사용하고, 없으면 기존 방식으로 표시
                if (response.parsedData) {
                    const pingData = response.parsedData;
                    // 핑 결과 포맷팅 - 한글 깨짐 문제 해결
                    let resultHtml = `
                        <div class="ping-results">
                            <div class="ping-summary">
                                <h6>Ping 요약:</h6>
                                <div class="ping-summary-grid">
                                    <div class="ping-stat">
                                        <strong>전송: </strong>${pingData.sent}
                                    </div>
                                    <div class="ping-stat">
                                        <strong>수신: </strong>${pingData.received}
                                    </div>
                                    <div class="ping-stat">
                                        <strong>손실: </strong>${pingData.lost} (${pingData.lossRate})
                                    </div>
                                    <div class="ping-stat">
                                        <strong>최소: </strong>${pingData.min}
                                    </div>
                                    <div class="ping-stat">
                                        <strong>최대: </strong>${pingData.max}
                                    </div>
                                    <div class="ping-stat">
                                        <strong>평균: </strong>${pingData.avg}
                                    </div>
                                </div>
                            </div>
                            <div class="ping-packets">
                                <h6>패킷 상세:</h6>
                                <div class="table-wrapper">
                                    <table class="data-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>IP 주소</th>
                                                <th>응답 시간</th>
                                                <th>TTL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                    `;
                    
                    pingData.packets.forEach((packet, index) => {
                        resultHtml += `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${packet.ip}</td>
                                <td>${packet.time}</td>
                                <td>${packet.ttl}</td>
                            </tr>
                        `;
                    });
                    
                    resultHtml += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <details class="raw-details">
                                <summary>원본 출력 보기</summary>
                                <pre>${pingData.rawOutput}</pre>
                            </details>
                        </div>
                    `;
                    
                    resultsContainer.innerHTML = resultHtml;
                } else {
                    // 기존 방식 (원본 출력)
                    displayResults(response.result);
                }
            } catch (error) {
                // API 요청 실패 시
                console.error("API 요청 실패:", error);
                displayResults(`API 요청 중 오류: ${error.message}`, true);
            }
            
            setStatus('success');
        } catch (error) {
            displayResults(error.message, true);
            setStatus('failed');
        }
    }
    
    // Traceroute test handler
    document.getElementById('traceroute-submit').addEventListener('click', async function() {
        const host = document.getElementById('traceroute-host').value.trim();
        const useRealtime = document.getElementById('traceroute-realtime').checked;
        
        if (!host) {
            displayResults('Please enter a host or IP address', true);
            return;
        }
        
        // 테스트 시작 전 결과 영역 초기화
        clearResults();
        
        if (useRealtime) {
            // Use WebSocket for real-time output
            const success = await executeRealtimeCommand('traceroute', { host });
            if (!success) {
                // Fall back to regular request
                resultsContainer.classList.remove('realtime-active');
                try {
                    const result = await makeRequest('traceroute', { host });
                    displayResults(result.result);
                } catch (error) {
                    displayResults(error.message, true);
                }
            }
        } else {
            // Use regular request
            try {
                const result = await makeRequest('traceroute', { host });
                displayResults(result.result);
            } catch (error) {
                displayResults(error.message, true);
            }
        }
    });
    
    // DNS Lookup handler
    document.getElementById('nslookup-submit').addEventListener('click', async function() {
        const host = document.getElementById('nslookup-host').value.trim();
        const type = document.getElementById('nslookup-type').value;
        
        if (!host) {
            displayResults('Please enter a domain name', true);
            return;
        }
        
        // 테스트 시작 전 결과 영역 초기화
        clearResults();
        
        try {
            const result = await makeRequest('nslookup', { host, type });
            displayResults(result);
        } catch (error) {
            displayResults(error.message, true);
        }
    });
    
    // UDP 테스트 핸들러
    document.getElementById('udp-submit')?.addEventListener('click', async function() {
        const host = document.getElementById('udp-host').value.trim();
        const port = document.getElementById('udp-port').value.trim();
        const data = document.getElementById('udp-data').value.trim();
        const timeout = document.getElementById('udp-timeout').value.trim();
        
        if (!host || !port) {
            displayResults('Host and port are required', true);
            return;
        }
        
        // 테스트 시작 전 결과 영역 초기화
        clearResults();
        
        try {
            setStatus('running');
            const result = await makeRequest('udp', { 
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
        
        // 테스트 시작 전 결과 영역 초기화
        clearResults();
        
        try {
            setStatus('running');
            const result = await makeRequest('tcp', { host, port: parseInt(port) });
            
            if (result.success) {
                displayResults(`✅ ${result.message || 'TCP 연결 성공!'}`, false);
            } else {
                displayResults(`❌ ${result.error || 'TCP 연결 실패'}`, true);
            }
            
            setStatus(result.success ? 'success' : 'failed');
        } catch (error) {
            displayResults(`❌ ${error.message}`, true);
            setStatus('failed');
        }
    });
    
    // MySQL 테스트
    document.getElementById('mysql-submit')?.addEventListener('click', function() {
        const host = document.getElementById('mysql-host').value;
        const port = document.getElementById('mysql-port').value;
        const user = document.getElementById('mysql-user').value;
        const password = document.getElementById('mysql-password').value;
        const database = document.getElementById('mysql-database').value;
        const query = document.getElementById('mysql-query').value;

        if (!host || !user) {
            displayResult('Host와 Username은 필수 항목입니다.', 'error');
            return;
        }

        // 결과 영역 초기화
        clearResults();
        
        // 쿼리가 있으면 쿼리 실행, 없으면 연결 테스트
        if (query.trim()) {
            makeRequest('/api/mysql/query', { host, port, user, password, database, query });
        } else {
            makeRequest('/api/mysql', { host, port, user, password, database });
        }
    });

    // PostgreSQL 테스트
    document.getElementById('postgres-submit')?.addEventListener('click', function() {
        const host = document.getElementById('postgres-host').value;
        const port = document.getElementById('postgres-port').value;
        const user = document.getElementById('postgres-user').value;
        const password = document.getElementById('postgres-password').value;
        const database = document.getElementById('postgres-database').value;
        const query = document.getElementById('postgres-query').value;

        if (!host || !user || !database) {
            displayResult('Host, Username, Database는 필수 항목입니다.', 'error');
            return;
        }

        // 결과 영역 초기화
        clearResults();
        
        // 쿼리가 있으면 쿼리 실행, 없으면 연결 테스트
        if (query.trim()) {
            makeRequest('/api/postgres/query', { host, port, user, password, database, query });
        } else {
            makeRequest('/api/postgres', { host, port, user, password, database });
        }
    });

    // MongoDB 테스트
    document.getElementById('mongodb-submit')?.addEventListener('click', function() {
        const host = document.getElementById('mongodb-host').value;
        const port = document.getElementById('mongodb-port').value;
        const user = document.getElementById('mongodb-user').value;
        const password = document.getElementById('mongodb-password').value;
        const database = document.getElementById('mongodb-database').value;
        const collection = document.getElementById('mongodb-collection').value;
        
        if (!host) {
            displayResult('Host는 필수 항목입니다.', 'error');
            return;
        }
        
        // 결과 영역 초기화
        clearResults();

        // 컬렉션이 지정된 경우 쿼리 실행
        if (collection.trim()) {
            const query = document.getElementById('mongodb-query').value;
            const projection = document.getElementById('mongodb-projection').value;
            const limit = document.getElementById('mongodb-limit').value;

            let queryObj, projectionObj;
            try {
                queryObj = query ? JSON.parse(query) : {};
                projectionObj = projection ? JSON.parse(projection) : {};
            } catch (e) {
                displayResult('JSON 형식이 올바르지 않습니다: ' + e.message, 'error');
                return;
            }

            makeRequest('/api/mongodb/query', { 
                host, port, user, password, database, collection, 
                query: queryObj, 
                projection: projectionObj, 
                limit: parseInt(limit) 
            });
        } else {
            // 컬렉션이 지정되지 않은 경우 연결 테스트만 수행
            makeRequest('/api/mongodb', { host, port, user, password, database });
        }
    });
    
    // Redis 연결 테스트
    document.getElementById('redis-submit')?.addEventListener('click', function() {
        const host = document.getElementById('redis-host').value;
        const port = document.getElementById('redis-port').value;
        const password = document.getElementById('redis-password').value;
        const db = document.getElementById('redis-db').value;
        
        if (!host) {
            displayResult('Host는 필수 항목입니다.', 'error');
            return;
        }
        
        // 결과 영역 초기화
        clearResults();

        makeRequest('/api/redis', { host, port, password, db });
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
            const result = await makeRequest('rabbitmq', { host, port, user, password, vhost });
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
            const result = await makeRequest('/api/ssl', { host, port });
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

    // 사이드바 메뉴 아이템 클릭 이벤트
    const sidebarItems = document.querySelectorAll('.sidebar-menu li');
    sidebarItems.forEach(item => {
        item.addEventListener('click', function() {
            // 모든 테스트 폼 숨기기
            const allForms = document.querySelectorAll('.test-form');
            allForms.forEach(form => form.classList.add('hidden'));

            // 선택한 메뉴 아이템의 데이터 속성에서 폼 ID 가져오기
            const testType = this.getAttribute('data-test');
            
            // 해당 테스트 폼이 존재하는지 확인
            const testForm = document.getElementById(`${testType}-form`);
            if (testForm) {
                testForm.classList.remove('hidden');
                // 현재 활성화된 메뉴 아이템 스타일 갱신
                sidebarItems.forEach(item => item.classList.remove('active'));
                this.classList.add('active');
            } else {
                console.error(`폼을 찾을 수 없음: ${testType}-form`);
                displayResult(`테스트 유형 "${testType}"에 대한 폼을 찾을 수 없습니다.`, 'error');
            }
        });
    });

    // WebSocket용 result 표시 함수
    function displayResult(message, type = 'success') {
        if (type === 'error') {
            resultsContainer.innerHTML = `<div class="result-error">Error: ${message}</div>`;
        } else {
            resultsContainer.innerHTML = `<div class="result-success">${message}</div>`;
        }
    }

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
            
            const result = await makeRequest('/api/http', { url, method, headers, data });
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
            
            webSocket.onopen = function() {
                if (wsConnectBtn) wsConnectBtn.classList.add('hidden');
                if (wsDisconnectBtn) wsDisconnectBtn.classList.remove('hidden');
                if (wsMessagePanel) wsMessagePanel.classList.remove('hidden');
                
                // 연결 성공 메시지를 결과 영역에 표시
                displayResults("✅ WebSocket 서버에 연결되었습니다", false);
                
                if (wsMessagesContainer) {
                    wsMessagesContainer.innerHTML = '<div class="message-success">Connected to WebSocket server</div>';
                }
                setStatus('success');
            };
            
            webSocket.onmessage = function(event) {
                // 웹소켓 메시지를 결과 영역에도 표시
                displayResults("📩 메시지 수신: " + event.data, false);
                
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, event.data);
                }
            };
            
            webSocket.onclose = function() {
                if (wsConnectBtn) wsConnectBtn.classList.remove('hidden');
                if (wsDisconnectBtn) wsDisconnectBtn.classList.add('hidden');
                if (wsMessagePanel) wsMessagePanel.classList.add('hidden');
                
                // 연결 종료 메시지를 결과 영역에 표시
                displayResults("🔌 WebSocket 연결이 종료되었습니다", false);
                
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, 'Connection closed');
                }
                webSocket = null;
                setStatus('ready');
            };
            
            webSocket.onerror = function(error) {
                if (wsMessagesContainer) {
                    displayWebSocketMessage(wsMessagesContainer, `Error: ${error.message || 'Unknown error'}`);
                }
                displayResults(`❌ WebSocket 오류: ${error.message || 'Unknown error'}`, true);
                setStatus('failed');
            };
        } catch (error) {
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
                displayResults('WebSocket 서버에 연결되지 않았습니다.', true);
                return;
            }
            
            const messageInput = document.getElementById('websocket-message');
            if (!messageInput) return;
            
            const message = messageInput.value;
            
            if (message) {
                webSocket.send(message);
                displayResults(`📤 메시지 전송: ${message}`, false);
                
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
            displayResults("🔄 Echo 서버에 연결 중...", false);
            
            // WebSocket 연결 설정
            setupWebSocket(echoUrl);
        });
    }
}); 