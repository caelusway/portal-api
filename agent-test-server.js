const http = require('http');
const fs = require('fs');
const path = require('path');

const port = 3456;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'agent-test.html');
    const content = fs.readFileSync(filePath, 'utf8');
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`
    🚀 Agent Test Server is running!
    🌐 Navigate to http://localhost:${port} to test WebSocket agent
    🔗 Will connect to WebSocket at ws://localhost:3001/ws/agent
  `);
}); 