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

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

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
app.post('/api/nslookup', (req, res) => {
  const { host, type } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  dns.lookup(host, (err, address, family) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // If specified record type, use it
    if (type && type !== 'ANY') {
      const method = `resolve${type}`;
      if (typeof dns[method] !== 'function') {
        return res.status(400).json({ error: `Invalid DNS record type: ${type}` });
      }
      
      dns[method](host, (err, records) => {
        if (err) {
          return res.json({ 
            ipAddress: address, 
            ipFamily: `IPv${family}`,
            records: []
          });
        }
        
        res.json({ 
          ipAddress: address, 
          ipFamily: `IPv${family}`,
          recordType: type,
          records 
        });
      });
    } else {
      // Otherwise resolve all record types
      dns.resolveAny(host, (err, records) => {
        if (err) {
          return res.json({ 
            ipAddress: address, 
            ipFamily: `IPv${family}`,
            records: []
          });
        }
        
        res.json({ 
          ipAddress: address, 
          ipFamily: `IPv${family}`,
          records 
        });
      });
    }
  });
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
      message: `TCP 포트 ${port}에 성공적으로 연결되었습니다 (${host})` 
    });
    socket.destroy();
  });
  
  socket.on('timeout', () => {
    res.status(500).json({ 
      success: false, 
      error: `${host}:${port}에 대한 연결이 ${timeout}ms 후 시간 초과되었습니다` 
    });
    socket.destroy();
  });
  
  socket.on('error', (error) => {
    res.status(500).json({ 
      success: false, 
      error: `TCP 연결 실패: ${error.message}` 
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

// SSL/TLS Certificate Info
app.post('/api/ssl', async (req, res) => {
  const { host, port } = req.body;
  
  if (!host) {
    return res.status(400).json({ error: 'Host is required' });
  }

  // Windows에서는 코드 페이지를 UTF-8로 설정
  const chcpCmd = process.platform === 'win32' ? 'chcp 65001 > nul && ' : '';
  const command = `${chcpCmd}echo | openssl s_client -servername ${host} -connect ${host}:${port || 443} -showcerts`;

  exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ 
        success: false,
        error: error.message, 
        stderr 
      });
    }
    
    res.json({ 
      success: true,
      result: stdout 
    });
  });
});

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

// WebSocket echo server
wss.on('connection', (ws) => {
  // Store command processes for this connection
  const processes = new Map();
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle different command types
      if (data.type === 'command') {
        const { id, cmd, args } = data;
        
        // Stop any existing process with this ID
        if (processes.has(id)) {
          const oldProcess = processes.get(id);
          try {
            oldProcess.kill();
          } catch (error) {
            // Ignore errors when killing process
          }
          processes.delete(id);
        }
        
        // Handle different commands
        if (cmd === 'ping') {
          const host = args.host;
          const count = args.count && !isNaN(parseInt(args.count)) ? parseInt(args.count) : 4;
          
          // Windows에서는 코드 페이지를 UTF-8로 설정
          const chcpCmd = process.platform === 'win32' ? 'chcp 65001 > nul && ' : '';
          const command = process.platform === 'win32' 
            ? `${chcpCmd}ping -n ${count} ${host}` 
            : `ping -c ${count} ${host}`;
          
          // Spawn the process
          const pingProcess = exec(command, { encoding: 'utf8' });
          processes.set(id, pingProcess);
          
          // Send data as it comes
          pingProcess.stdout.on('data', (data) => {
            ws.send(JSON.stringify({
              type: 'output',
              id,
              data,
              complete: false
            }));
          });
          
          pingProcess.stderr.on('data', (data) => {
            ws.send(JSON.stringify({
              type: 'error',
              id,
              data,
              complete: false
            }));
          });
          
          pingProcess.on('close', (code) => {
            ws.send(JSON.stringify({
              type: 'complete',
              id,
              exitCode: code,
              complete: true
            }));
            processes.delete(id);
          });
        } else if (cmd === 'traceroute') {
          const host = args.host;
          
          // Windows에서는 코드 페이지를 UTF-8로 설정
          const chcpCmd = process.platform === 'win32' ? 'chcp 65001 > nul && ' : '';
          const command = process.platform === 'win32' 
            ? `${chcpCmd}tracert ${host}` 
            : `traceroute -m 15 ${host}`;
          
          // Spawn the process
          const traceProcess = exec(command, { encoding: 'utf8' });
          processes.set(id, traceProcess);
          
          // Send data as it comes
          traceProcess.stdout.on('data', (data) => {
            ws.send(JSON.stringify({
              type: 'output',
              id,
              data,
              complete: false
            }));
          });
          
          traceProcess.stderr.on('data', (data) => {
            ws.send(JSON.stringify({
              type: 'error',
              id,
              data,
              complete: false
            }));
          });
          
          traceProcess.on('close', (code) => {
            ws.send(JSON.stringify({
              type: 'complete',
              id,
              exitCode: code,
              complete: true
            }));
            processes.delete(id);
          });
        } else {
          // Echo unknown commands
          ws.send(JSON.stringify({
            type: 'error',
            id,
            data: `Unknown command: ${cmd}`,
            complete: true
          }));
        }
      } else {
        // Echo back other message types
        ws.send(`Echo: ${message}`);
      }
    } catch (error) {
      // For non-JSON messages, just echo back
      ws.send(`Echo: ${message}`);
    }
  });
  
  ws.on('close', () => {
    // Clean up all processes when connection closes
    for (const process of processes.values()) {
      try {
        process.kill();
      } catch (error) {
        // Ignore errors when killing process
      }
    }
    processes.clear();
  });
  
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to WebSocket server'
  }));
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

// Start server
server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
}); 