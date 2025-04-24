import server from './app';
import config from './config';

// Start server
server.listen(config.port, () => {
  console.log(`
    🚀 Server is running!
    🌐 Listening on port ${config.port}
    🔗 http://localhost:${config.port}
    📊 Environment: ${config.env}
  `);
});
