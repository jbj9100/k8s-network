const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const dns = require('dns');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const mongoose = require('mongoose');
const axios = require('axios');
const http = require('http');
const WebSocket = require('ws');
const redis = require('redis');
const { promisify } = require('util');
const amqp = require('amqplib');
const fs = require('fs').promises;
const os = require('os');
const { spawn } = require('child_process');

const app = express();
let port = process.env.PORT || 3000;

// 명령줄 인수에서 포트 지정 확인 (--port=XXXX)
process.argv.forEach((arg) => {
  if (arg.startsWith('--port=')) {
    const portArg = parseInt(arg.split('=')[1]);
    if (!isNaN(portArg)) {
      console.log(`Port specified via command line: ${portArg}`);
      port = portArg;
    }
  }
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server with /ws path
const wss = new WebSocket.Server({ 
    server: server,
    path: '/ws'
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Root endpoint
app.get('/api', (req, res) => {
  res.json({ message: 'K8s Network Test API is running' });
});

// Ping Test
app.post('/api/ping', (req, res) => {
  const { host, count } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  const pingCount = count && !isNaN(parseInt(count)) ? parseInt(count) : 4;

  // Windows에서는 코드 페이지를 UTF-8로 설정하고 확실하게 인코딩 관련 변수 설정
  // 강제로 UTF-8 인코딩 사용을 위한 환경변수 설정
  const env = Object.assign({}, process.env, { 
    LANG: 'ko_KR.UTF-8',
    LC_ALL: 'ko_KR.UTF-8'
  });
  
  const chcpCmd = process.platform === 'win32' ? 'chcp 65001 > nul && ' : '';
  const command = process.platform === 'win32' 
    ? `${chcpCmd}ping -n ${pingCount} ${host}` 
    : `ping -c ${pingCount} ${host}`;

  exec(command, { encoding: 'utf8', env }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message, stderr });
    }
    
    // 파싱된 결과를 저장할 객체 초기화
    const pingData = {
      host: host,
      count: pingCount,
      sent: 0,
      received: 0,
      lost: 0,
      lossRate: '0%',
      min: '0ms',
      max: '0ms',
      avg: '0ms',
      rawOutput: stdout,
      packets: []
    };
    
    try {
      // 정규식으로 ping 결과 파싱
      const packetLineRegex = /(\d+\.\d+\.\d+\.\d+).+?(\d+)ms.+?TTL=(\d+)/g;
      let match;
      
      while ((match = packetLineRegex.exec(stdout)) !== null) {
        pingData.packets.push({
          ip: match[1],
          time: match[2] + 'ms',
          ttl: match[3]
        });
        pingData.received++;
      }
      
      pingData.sent = pingCount;
      pingData.lost = pingData.sent - pingData.received;
      pingData.lossRate = ((pingData.lost / pingData.sent) * 100).toFixed(0) + '%';
      
      // 응답 시간 통계 계산
      if (pingData.packets.length > 0) {
        const times = pingData.packets.map(p => parseInt(p.time));
        pingData.min = Math.min(...times) + 'ms';
        pingData.max = Math.max(...times) + 'ms';
        pingData.avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length) + 'ms';
      }
      
      return res.json({ 
        result: stdout,  // 원본 결과 유지
        parsedData: pingData  // 구조화된 데이터 추가
      });
    } catch (error) {
      console.error('Ping result parsing error:', error);
      // 파싱 오류가 발생해도 원본 결과는 반환
      return res.json({ result: stdout });
    }
  });
});

// Traceroute Test
app.post('/api/traceroute', (req, res) => {
  const { host } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  // Windows에서는 코드 페이지를 UTF-8로 설정
  const chcpCmd = process.platform === 'win32' ? 'chcp 65001 > nul && ' : '';
  const command = process.platform === 'win32' 
    ? `${chcpCmd}tracert ${host}` 
    : `traceroute -m 15 ${host}`;

  exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message, stderr });
    }
    res.json({ result: stdout });
  });
});

// DNS Lookup Test
app.post('/api/nslookup', async (req, res) => {
    const { host, type, dnsServer } = req.body;
    
    if (!host) {
        return res.status(400).json({ success: false, error: 'Host is required' });
    }
    
    try {
        // DNS 서버가 지정되지 않은 경우 /etc/resolv.conf에서 읽기
        let useDnsServer = dnsServer;
        if (!useDnsServer) {
            try {
                // Windows에서는 /etc/resolv.conf가 없으므로 에러를 무시합니다
                if (process.platform !== 'win32') {
                    // /etc/resolv.conf 파일 읽기
                    const resolveConf = await fs.readFile('/etc/resolv.conf', 'utf8');
                    const nameserverMatch = resolveConf.match(/nameserver\s+([^\s]+)/);
                    if (nameserverMatch && nameserverMatch[1]) {
                        useDnsServer = nameserverMatch[1];
                        console.log(`Using nameserver from /etc/resolv.conf: ${useDnsServer}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to read /etc/resolv.conf: ${error.message}`);
                // 기본 시스템 DNS 사용
            }
        }
        
        let command = '';
        const os = require('os').platform();
        
        // 타입이 'ANY'일 경우 특별 처리
        const recordType = (type === 'ANY') ? 'A' : (type || 'A');
        
        if (os === 'win32') {
            command = `nslookup -type=${recordType} ${host}`;
            if (useDnsServer) {
                command = `nslookup -type=${recordType} ${host} ${useDnsServer}`;
            }
        } else {
            if (useDnsServer) {
                command = `nslookup -type=${recordType} ${host} ${useDnsServer}`;
            } else {
                command = `nslookup -type=${recordType} ${host}`;
            }
        }
        
        console.log(`Executing DNS lookup: ${command}`);
        
        // exec 함수는 promise를 반환하므로 await로 결과를 받음
        const execPromise = require('util').promisify(require('child_process').exec);
        const { stdout, stderr } = await execPromise(command);
        
        // 디버깅을 위해 출력 로깅
        console.log('nslookup stdout:', stdout);
        console.log('nslookup stderr:', stderr);
        
        let ipAddress = '';
        let ipFamily = '';
        let records = [];
        
        // IP 주소 추출 (정규식 사용)
        const ipv4Regex = /Address:\s*(\d+\.\d+\.\d+\.\d+)/g;
        let ipv4Match;
        let ipv4Matches = [];
        
        while ((ipv4Match = ipv4Regex.exec(stdout)) !== null) {
            ipv4Matches.push(ipv4Match[1]);
        }
        
        // Windows에서 nslookup의 출력 형식이 다를 수 있어 특별히 처리
        if (os === 'win32') {
            // 응답 파싱
            const lines = stdout.split('\n');
            let currentRecord = null;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // 서버 정보 라인은 건너뜀
                if (line.includes('Server:') || line.includes('Address:') && i < 3) {
                    continue;
                }
                
                // 이름 정보 (일반적으로 응답 시작)
                if (line.includes('Name:')) {
                    currentRecord = { type: recordType };
                    records.push(currentRecord);
                    continue;
                }
                
                // 주소 정보를 찾아서 파싱
                if (line.match(/^Address/) && currentRecord) {
                    const addrMatch = line.match(/Address:\s*(\S+)/);
                    if (addrMatch && addrMatch[1]) {
                        currentRecord.address = addrMatch[1];
                        // 첫 번째 IP 주소를 기본 IP 주소로 설정
                        if (!ipAddress) {
                            ipAddress = addrMatch[1];
                            // IPv4 또는 IPv6 확인
                            ipFamily = addrMatch[1].includes(':') ? 'IPv6' : 'IPv4';
                        }
                    }
                    continue;
                }
                
                // 다른 유형의 레코드 정보 (MX, NS 등)
                if (line.includes('mail exchanger')) {
                    const mxMatch = line.match(/mail exchanger = (\d+) (.+)\.$/);
                    if (mxMatch && currentRecord) {
                        currentRecord.preference = mxMatch[1];
                        currentRecord.exchange = mxMatch[2];
                    }
                } else if (line.includes('nameserver')) {
                    const nsMatch = line.match(/nameserver = (.+)\.$/);
                    if (nsMatch && currentRecord) {
                        currentRecord.nameserver = nsMatch[1];
                    }
                } else if (line.includes('text')) {
                    const txtMatch = line.match(/text = "(.+)"$/);
                    if (txtMatch && currentRecord) {
                        currentRecord.text = txtMatch[1];
                    }
                }
            }
        } else {
            // 리눅스/macOS용 기존 파싱 로직
            if (ipv4Matches.length > 1) {
                // 첫 번째는 DNS 서버 주소일 수 있으므로 두 번째 사용
                ipAddress = ipv4Matches[1];
                ipFamily = 'IPv4';
                
                // 간단한 A 레코드 추가
                records.push({
                    type: recordType,
                    address: ipAddress
                });
            }
            
            // IPv6 주소 확인
            if (!ipAddress) {
                const ipv6Regex = /Address:\s*([0-9a-f:]+)/gi;
                let ipv6Match = ipv6Regex.exec(stdout);
                if (ipv6Match) {
                    ipAddress = ipv6Match[1];
                    ipFamily = 'IPv6';
                    
                    // 간단한 AAAA 레코드 추가
                    records.push({
                        type: 'AAAA',
                        address: ipAddress
                    });
                }
            }
        }
        
        // 기본 IP 주소 확인
        if (!ipAddress && ipv4Matches.length > 0) {
            ipAddress = ipv4Matches[0];
            ipFamily = 'IPv4';
        }
        
        // 레코드가 없으면 기본 레코드 추가
        if (records.length === 0 && ipAddress) {
            records.push({
                type: recordType,
                address: ipAddress
            });
        }
        
        return res.json({
            success: true,
            ipAddress: ipAddress,
            ipFamily: ipFamily,
            records: records,
            rawOutput: stdout,
            dnsServer: useDnsServer || 'Default system DNS'
        });
    } catch (error) {
        console.error('DNS lookup error:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            rawOutput: error.stderr || error.message
        });
    }
});

// MySQL DB Connection Test
app.post('/api/mysql', async (req, res) => {
  const { host, port, user, password, database } = req.body;
  
  if (!host || !user) {
    return res.status(400).json({ error: 'Host and user are required' });
  }

  try {
    const connection = await mysql.createConnection({
      host,
      port: port || 3306,
      user,
      password: password || '',
      database: database || '',
      connectTimeout: 10000
    });

    await connection.ping();
    const [rows] = await connection.execute('SELECT 1 as connection_test');
    await connection.end();
    
    res.json({ 
      success: true, 
      message: 'MySQL connection successful',
      details: rows[0]
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// MySQL DB Query Test
app.post('/api/mysql/query', async (req, res) => {
  const { host, port, user, password, database, query } = req.body;
  
  if (!host || !user || !database) {
    return res.status(400).json({ error: 'Host, user, and database are required' });
  }

  if (!query) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Check if the query is safe (read-only)
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.startsWith('insert') || 
      normalizedQuery.startsWith('update') || 
      normalizedQuery.startsWith('delete') || 
      normalizedQuery.startsWith('drop') || 
      normalizedQuery.startsWith('alter') || 
      normalizedQuery.startsWith('create')) {
    return res.status(400).json({ 
      success: false, 
      error: 'Only SELECT queries are allowed for security reasons' 
    });
  }

  try {
    const connection = await mysql.createConnection({
      host,
      port: port || 3306,
      user,
      password: password || '',
      database,
      connectTimeout: 10000
    });

    const [rows, fields] = await connection.execute(query);
    await connection.end();
    
    res.json({ 
      success: true, 
      message: 'Query executed successfully',
      rowCount: rows.length,
      fields: fields ? fields.map(f => f.name) : [],
      data: rows
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// PostgreSQL DB Connection Test
app.post('/api/postgres', async (req, res) => {
  const { host, port, user, password, database } = req.body;
  
  if (!host || !user || !database) {
    return res.status(400).json({ error: 'Host, user, and database are required' });
  }

  const pool = new Pool({
    host,
    port: port || 5432,
    user,
    password: password || '',
    database,
    connectionTimeoutMillis: 10000
  });

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT 1 as connection_test');
    client.release();
    await pool.end();
    
    res.json({ 
      success: true, 
      message: 'PostgreSQL connection successful',
      details: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// PostgreSQL DB Query Test
app.post('/api/postgres/query', async (req, res) => {
  const { host, port, user, password, database, query } = req.body;
  
  if (!host || !user || !database) {
    return res.status(400).json({ error: 'Host, user, and database are required' });
  }

  if (!query) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Check if the query is safe (read-only)
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.startsWith('insert') || 
      normalizedQuery.startsWith('update') || 
      normalizedQuery.startsWith('delete') || 
      normalizedQuery.startsWith('drop') || 
      normalizedQuery.startsWith('alter') || 
      normalizedQuery.startsWith('create')) {
    return res.status(400).json({ 
      success: false, 
      error: 'Only SELECT queries are allowed for security reasons' 
    });
  }

  const pool = new Pool({
    host,
    port: port || 5432,
    user,
    password: password || '',
    database,
    connectionTimeoutMillis: 10000
  });

  try {
    const client = await pool.connect();
    const result = await client.query(query);
    client.release();
    await pool.end();
    
    res.json({ 
      success: true, 
      message: 'Query executed successfully',
      rowCount: result.rowCount,
      fields: result.fields ? result.fields.map(f => f.name) : [],
      data: result.rows
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// MongoDB Connection Test
app.post('/api/mongodb', async (req, res) => {
  const { host, port, user, password, database } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  let connectionString = 'mongodb://';
  
  if (user && password) {
    connectionString += `${user}:${password}@`;
  }
  
  connectionString += `${host}:${port || 27017}`;
  
  if (database) {
    connectionString += `/${database}`;
  }

  try {
    const connection = await mongoose.connect(connectionString, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    const result = await mongoose.connection.db.admin().ping();
    
    // Get list of collections if a database was specified
    let collections = [];
    if (database) {
      collections = await mongoose.connection.db.listCollections().toArray();
      collections = collections.map(c => c.name);
    }
    
    await mongoose.disconnect();
    
    res.json({
      success: true,
      message: 'MongoDB connection successful',
      details: result,
      collections: collections
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// MongoDB Query Test
app.post('/api/mongodb/query', async (req, res) => {
  const { host, port, user, password, database, collection, query, projection, limit } = req.body;
  
  if (!host || !database || !collection) {
    return res.status(400).json({ error: 'Host, database, and collection are required' });
  }

  let connectionString = 'mongodb://';
  
  if (user && password) {
    connectionString += `${user}:${password}@`;
  }
  
  connectionString += `${host}:${port || 27017}/${database}`;

  try {
    await mongoose.connect(connectionString, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    // 이미 query와 projection이 객체인 경우 처리
    let queryObject = query || {};
    let projectionObject = projection || {};
    
    // 최대 결과 수
    const limitValue = limit && !isNaN(parseInt(limit)) ? parseInt(limit) : 100;
    
    // Execute the query
    let cursor = mongoose.connection.db.collection(collection).find(queryObject, { projection: projectionObject });
    cursor = cursor.limit(limitValue);
    
    const documents = await cursor.toArray();
    await mongoose.disconnect();
    
    res.json({
      success: true,
      message: 'Query executed successfully',
      count: documents.length,
      data: documents
    });
  } catch (error) {
    await mongoose.disconnect();
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// TCP Port Check
app.post('/api/tcp', (req, res) => {
  const { host, port } = req.body;
  
  if (!host || !port) {
    return res.status(400).json({ error: 'Host and port are required' });
  }

  const socket = new net.Socket();
  const timeout = 10000;
  
  socket.setTimeout(timeout);
  
  socket.on('connect', () => {
    res.json({ 
      success: true, 
      message: `Successfully connected to TCP port ${port} (${host})` 
    });
    socket.destroy();
  });
  
  socket.on('timeout', () => {
    res.status(500).json({ 
      success: false, 
      error: `Connection to ${host}:${port} timed out after ${timeout}ms` 
    });
    socket.destroy();
  });
  
  socket.on('error', (error) => {
    res.status(500).json({ 
      success: false, 
      error: `TCP connection failed: ${error.message}` 
    });
    socket.destroy();
  });
  
  socket.connect(port, host);
});

// HTTP API Test
app.post('/api/http', async (req, res) => {
  const { url, method, headers, data, timeout } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const response = await axios({
      url,
      method: method || 'GET',
      headers: headers || {},
      data: data || null,
      timeout: timeout || 10000,
      validateStatus: () => true  // Don't throw on any status code
    });
    
    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Redis Connection Test
app.post('/api/redis', async (req, res) => {
  const { host, port, password, db } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  const client = redis.createClient({
    url: `redis://${password ? `:${password}@` : ''}${host}:${port || 6379}/${db || 0}`
  });

  // Promisify Redis commands
  const pingAsync = promisify(client.ping).bind(client);
  const infoAsync = promisify(client.info).bind(client);
  const quitAsync = promisify(client.quit).bind(client);

  client.on('error', async (error) => {
    await quitAsync().catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message
    });
  });

  try {
    // Connect to Redis
    client.on('connect', async () => {
      try {
        const pingResult = await pingAsync();
        const infoResult = await infoAsync();
        
        // Parse info string into an object
        const infoObj = {};
        infoResult.split('\r\n').forEach(line => {
          if (line && !line.startsWith('#') && line.includes(':')) {
            const [key, value] = line.split(':');
            infoObj[key] = value;
          }
        });
        
        await quitAsync();
        
        res.json({
          success: true,
          message: 'Redis connection successful',
          ping: pingResult,
          info: infoObj
        });
      } catch (error) {
        await quitAsync().catch(() => {});
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
  } catch (error) {
    await quitAsync().catch(() => {});
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// RabbitMQ Connection Test
app.post('/api/rabbitmq', async (req, res) => {
  const { host, port, user, password, vhost } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  const credentials = user && password ? `${user}:${password}@` : '';
  const vhostPath = vhost ? `/${vhost}` : '';
  const connectionUrl = `amqp://${credentials}${host}:${port || 5672}${vhostPath}`;

  try {
    const connection = await amqp.connect(connectionUrl);
    const channel = await connection.createChannel();
    
    // Get connection details
    const details = {
      connection: {
        server: connection.connection.serverProperties,
        client: connection.connection.clientProperties
      }
    };
    
    await channel.close();
    await connection.close();
    
    res.json({
      success: true,
      message: 'RabbitMQ connection successful',
      details: details
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// System Information
app.get('/api/sysinfo', async (req, res) => {
  try {
    const info = {
      hostname: os.hostname(),
      platform: os.platform(),
      architecture: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
      cpus: os.cpus().length,
      network: os.networkInterfaces()
    };
    
    res.json(info);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

// SSL/TLS Certificate Info (using built-in Node.js TLS module)
app.post('/api/ssl', async (req, res) => {
  const { host, port } = req.body;
  const tls = require('tls');
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  try {
    // 타임아웃 처리를 위한 변수
    let isResponded = false;
    let socketClosed = false;
    let certificateInfo = 'No certificate information available';
    
    // 타임아웃 핸들러
    const timeoutId = setTimeout(() => {
      if (!isResponded && !socketClosed) {
        isResponded = true;
        try {
          if (socket) socket.destroy();
        } catch (e) {
          console.error('소켓 종료 중 오류:', e);
        }
        return res.status(500).json({
          success: false,
          error: `Connection to ${host}:${port || 443} timed out`
        });
      }
    }, 10000); // 10초 타임아웃
    
    // 소켓 연결 생성
    const socket = tls.connect({
      host: host,
      port: port || 443,
      servername: host, // SNI 지원
      rejectUnauthorized: false, // 자체 서명 인증서 허용
    });

    // 연결 성공 이벤트
    socket.on('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate(true);
        if (cert && Object.keys(cert).length > 0) {
          certificateInfo = formatCertificateInfo(cert);
        }
        socket.end();
      } catch (error) {
        console.error('인증서 정보 처리 오류:', error);
        if (!isResponded) {
          isResponded = true;
          clearTimeout(timeoutId);
          res.status(500).json({
            success: false,
            error: `인증서 정보 처리 오류: ${error.message}`
          });
        }
        socket.destroy();
      }
    });

    // 에러 이벤트
    socket.on('error', (error) => {
      if (!isResponded) {
        isResponded = true;
        clearTimeout(timeoutId);
        res.status(500).json({
          success: false,
          error: `연결 실패: ${error.message}`
        });
      }
      try {
        socket.destroy();
      } catch (e) {
        console.error('에러 후 소켓 종료 오류:', e);
      }
    });

    // 종료 이벤트
    socket.on('end', () => {
      socketClosed = true;
      clearTimeout(timeoutId);
      if (!isResponded) {
        isResponded = true;
        res.json({
          success: true,
          result: certificateInfo
        });
      }
    });
    
    // 닫힘 이벤트
    socket.on('close', () => {
      socketClosed = true;
      clearTimeout(timeoutId);
      if (!isResponded) {
        isResponded = true;
        res.json({
          success: true,
          result: certificateInfo
        });
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `인증서 확인 실패: ${error.message}`
    });
  }
});

// 인증서 정보를 읽기 쉬운 형식으로 변환
function formatCertificateInfo(cert) {
  if (!cert || Object.keys(cert).length === 0) {
    return 'No certificate information available';
  }

  try {
    let result = '=== Certificate Information ===\n\n';
    
    // 주체 정보
    if (cert.subject) {
      result += 'Subject:\n';
      for (const key in cert.subject) {
        result += `  ${key}: ${cert.subject[key]}\n`;
      }
      result += '\n';
    }
    
    // 발급자 정보
    if (cert.issuer) {
      result += 'Issuer:\n';
      for (const key in cert.issuer) {
        result += `  ${key}: ${cert.issuer[key]}\n`;
      }
      result += '\n';
    }
    
    // 유효 기간
    if (cert.valid_from && cert.valid_to) {
      result += 'Validity:\n';
      result += `  Not Before: ${cert.valid_from}\n`;
      result += `  Not After: ${cert.valid_to}\n\n`;
    }
    
    // 지문
    if (cert.fingerprint) {
      result += `Fingerprint: ${cert.fingerprint}\n\n`;
    }
    
    // 서명 알고리즘
    if (cert.serialNumber) {
      result += `Serial Number: ${cert.serialNumber}\n`;
    }
    
    // 대체 이름 (Subject Alternative Names)
    if (cert.subjectaltname) {
      result += `\nSubject Alternative Names: ${cert.subjectaltname}\n`;
    }
    
    // 인증서 버전
    if (cert.version) {
      result += `\nVersion: ${cert.version}\n`;
    }
    
    // 공개키 정보
    if (cert.bits) {
      result += `\nKey Size: ${cert.bits} bits\n`;
    }
    
    // 안전하게 처리 가능한 확장 속성들만 포함
    if (cert.extensions) {
      result += '\nExtensions:\n';
      for (const key in cert.extensions) {
        const ext = cert.extensions[key];
        if (typeof ext === 'string') {
          result += `  ${key}: ${ext}\n`;
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('인증서 정보 변환 중 오류:', error);
    return `Certificate information available but could not be formatted: ${error.message}`;
  }
}

// WebSocket connection test
app.post('/api/websocket', (req, res) => {
  // Just verify the URL syntax and respond
  // The actual connection test happens in the client
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'WebSocket URL is required' });
  }
  
  try {
    // Validate URL format
    new URL(url);
    res.json({ 
      success: true, 
      message: 'WebSocket URL is valid. Connection test should be performed by the client.'
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: 'Invalid WebSocket URL format'
    });
  }
});

// 실행 중인 프로세스 추적을 위한 Map
const runningProcesses = new Map();

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    // 웰컴 메시지 전송
    ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to WebSocket server'
    }));

    // 메시지 수신 처리
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (e) {
            ws.send(JSON.stringify({ 
                type: 'error',
                error: 'Invalid message format' 
            }));
            return;
        }

        // 명령 실행 요청 처리
        if (data.type === 'command') {
            const { cmd, args = [] } = data;
            const commandId = data.id || `cmd_${Date.now()}`;

            console.log(`Executing command: ${cmd} ${JSON.stringify(args)}`);

            // 지원되는 명령 확인
            if (!['ping', 'traceroute', 'nslookup'].includes(cmd)) {
                ws.send(JSON.stringify({
                    type: 'error',
                    id: commandId,
                    data: 'Unsupported command. Supported commands: ping, traceroute, nslookup',
                }));
                return;
            }

            let spawnArgs = [];
            let command = cmd;

            // 명령별 인자 처리
            if (cmd === 'ping') {
                const host = args.host;
                const count = args.count || 4;
                
                // Windows일 경우 명령어 변경 
                const isWindows = os.platform() === 'win32';
                if (isWindows) {
                    spawnArgs = ['-n', count.toString(), host];
                } else {
                    spawnArgs = ['-c', count.toString(), host];
                }
            } else if (cmd === 'traceroute') {
                const host = args.host;
                
                // Windows일 경우 명령어 변경
                const isWindows = os.platform() === 'win32';
                if (isWindows) {
                    command = 'tracert';
                    spawnArgs = [host];
                } else {
                    spawnArgs = ['-m', '15', host];
                }
            } else if (cmd === 'nslookup') {
                spawnArgs = [args.host];
            }

            // 명령 실행 프로세스 생성
            const process = spawn(command, spawnArgs, { 
                env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } 
            });
            
            // 프로세스 Map에 저장
            runningProcesses.set(commandId, process);

            // 프로세스 ID 전송
            ws.send(JSON.stringify({ 
                type: 'start',
                id: commandId 
            }));

            // 출력 데이터 처리
            process.stdout.on('data', (data) => {
                ws.send(JSON.stringify({
                    type: 'output',
                    id: commandId,
                    data: data.toString()
                }));
            });

            // 오류 데이터 처리
            process.stderr.on('data', (data) => {
                ws.send(JSON.stringify({
                    type: 'error',
                    id: commandId,
                    data: data.toString()
                }));
            });

            // 프로세스 종료 처리
            process.on('close', (code) => {
                console.log(`Process terminated, exit code: ${code}`);
                ws.send(JSON.stringify({
                    type: 'complete',
                    id: commandId,
                    exitCode: code
                }));
                
                // 완료된 프로세스 Map에서 삭제
                runningProcesses.delete(commandId);
            });

            // 프로세스 오류 처리
            process.on('error', (err) => {
                console.error(`Process error: ${err.message}`);
                ws.send(JSON.stringify({
                    type: 'error',
                    id: commandId,
                    data: `Command execution error: ${err.message}`
                }));
                
                // 오류 발생 프로세스 Map에서 삭제
                runningProcesses.delete(commandId);
            });
        }
        // 취소 명령 처리
        else if (data.type === 'cancel') {
            const commandId = data.id || data.processId;
            
            if (commandId && runningProcesses.has(commandId)) {
                const process = runningProcesses.get(commandId);
                
                try {
                    // 프로세스 종료 시도
                    process.kill();
                    ws.send(JSON.stringify({
                        type: 'cancelled',
                        id: commandId,
                        message: 'Process canceled successfully'
                    }));
                    
                    // Map에서 삭제
                    runningProcesses.delete(commandId);
                } catch (error) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        id: commandId,
                        data: `Failed to terminate process: ${error.message}`
                    }));
                }
            } else {
                ws.send(JSON.stringify({
                    type: 'error',
                    id: commandId || 'unknown',
                    data: 'No process found to cancel'
                }));
            }
        }
        // 에코 테스트 처리
        else if (data.type === 'echo') {
            ws.send(JSON.stringify({
                type: 'echo',
                data: data.data || 'Echo from server'
            }));
        }
    });

    // 연결 종료 처리
    ws.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

// Real-time Command Endpoint (for streaming commands)
app.post('/api/realtime-command', (req, res) => {
  // Just give instructions to connect to WebSocket
  res.json({
    success: true,
    message: 'Use WebSocket connection for real-time command output'
  });
});

// UDP 테스트
app.post('/api/udp', (req, res) => {
  const { host, port, data, timeout } = req.body;
  
  if (!host || !port) {
    return res.status(400).json({ error: 'Host and port are required' });
  }

  const timeoutDuration = timeout || 3000; // 기본 타임아웃 3초
  const message = data || 'Hello, UDP server!';
  
  // UDP 클라이언트 생성
  const client = dgram.createSocket('udp4');
  let responseReceived = false;
  
  // 메시지 수신 이벤트
  client.on('message', (msg, rinfo) => {
    responseReceived = true;
    client.close();
    res.json({ 
      result: `UDP Connection successful to ${host}:${port}\nResponse from ${rinfo.address}:${rinfo.port}\nReceived: ${msg.toString()}`,
      success: true,
      response: msg.toString(),
      from: {
        address: rinfo.address,
        port: rinfo.port,
        size: rinfo.size
      } 
    });
  });
  
  // 에러 이벤트 처리
  client.on('error', (err) => {
    client.close();
    if (!responseReceived) {
      res.status(500).json({ 
        error: `UDP error: ${err.message}`,
        success: false
      });
    }
  });
  
  // 타임아웃 설정
  const timer = setTimeout(() => {
    if (!responseReceived) {
      client.close();
      // 타임아웃은 항상 오류가 아님 - UDP는 응답을 기대하지 않는 프로토콜
      res.json({ 
        result: `UDP packet sent to ${host}:${port} (No response received within ${timeoutDuration}ms, but this is normal for UDP)`,
        success: true, 
        noResponse: true
      });
    }
  }, timeoutDuration);
  
  // 데이터 전송
  const buffer = Buffer.from(message);
  client.send(buffer, 0, buffer.length, port, host, (err) => {
    if (err) {
      clearTimeout(timer);
      client.close();
      return res.status(500).json({ 
        error: `Failed to send UDP packet: ${err.message}`,
        success: false
      });
    }
    // 여기서는 응답하지 않음 - message 이벤트나 타임아웃에서 응답 처리
  });
});

// Curl 테스트 (HTTP 요청 상세 정보)
app.post('/api/curl', (req, res) => {
  const { url, method, headers, data, options } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      success: false,
      error: 'URL is required' 
    });
  }
  
  // Windows 환경에서 curl이 설치되어 있는지 먼저 확인
  if (process.platform === 'win32') {
    exec('where curl', (error, stdout, stderr) => {
      if (error) {
        console.error('curl command not found in PATH:', error);
        return res.status(500).json({
          success: false,
          error: 'curl command not found. Please install curl and add it to your PATH.'
        });
      } else {
        console.log('curl found at:', stdout.trim());
        executeCurlCommand();
      }
    });
  } else {
    // Linux/Mac에서는 바로 실행
    executeCurlCommand();
  }
  
  function executeCurlCommand() {
    // curl 명령어 구성
    let curlCmd = 'curl';
    
    // 요청 방식 설정
    if (method && method !== 'GET') {
      curlCmd += ` -X ${method}`;
    }
    
    // 헤더 추가
    if (headers && typeof headers === 'object') {
      Object.entries(headers).forEach(([key, value]) => {
        curlCmd += ` -H "${key}: ${value.replace(/"/g, '\\"')}"`;
      });
    }
    
    // 요청 데이터 추가
    if (data) {
      // JSON 데이터인 경우 Content-Type 헤더 추가
      if (typeof data === 'object') {
        curlCmd += ` -H "Content-Type: application/json"`;
        curlCmd += ` -d '${JSON.stringify(data)}'`;
      } else {
        curlCmd += ` -d '${data}'`;
      }
    }
    
    // 추가 옵션 (예: -v, -i 등)
    if (options) {
      curlCmd += ` ${options}`;
    }
    
    // 최종 URL 추가
    curlCmd += ` "${url}"`;
    
    // Windows에서는 코드 페이지를 UTF-8로 설정
    const chcpCmd = process.platform === 'win32' ? 'chcp 65001 > nul && ' : '';
    const command = `${chcpCmd}${curlCmd}`;
    
    console.log('Executing curl command:', command);
    
    // 확장된 환경 변수 설정
    const env = {
      ...process.env,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8'
    };
    
    // 명령 실행
    exec(command, { 
      encoding: 'utf8', 
      maxBuffer: 1024 * 1024 * 10,
      env: env,
      timeout: 30000 // 30초 타임아웃
    }, (error, stdout, stderr) => {
      console.log('curl execution completed');
      
      if (error) {
        console.error('curl execution error:', error);
        console.error('stderr:', stderr);
      } else {
        console.log('curl executed successfully');
      }
      
      let result = {
        success: !error,
        command: curlCmd,
        stdout: stdout || '',
        stderr: stderr || ''
      };
      
      if (error) {
        result.error = error.message;
        console.error('Curl execution error:', error);
        
        // Even with error, we might have partial results
        // For example, a 404 status will return an error but the command still ran
        if (stdout || stderr) {
          result.success = true;
          result.partialSuccess = true;
          result.note = 'Command executed but returned a non-zero exit code';
        }
      }
      
      // Try to parse the response if it looks like JSON
      if (stdout && stdout.trim().startsWith('{') && stdout.trim().endsWith('}')) {
        try {
          result.parsedResponse = JSON.parse(stdout);
        } catch (e) {
          console.log('Response is not valid JSON');
        }
      }
      
      res.json(result);
    });
  }
});

// Start server
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});