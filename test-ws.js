// Test WebSocket commands for BioDAO CoreAgent

const WebSocket = require('ws');
const readline = require('readline');

// Default WebSocket URL
const WS_URL = 'ws://localhost:3001';

// Create readline interface for terminal input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Initialize WebSocket
let ws = null;
let userId = null;

// Connect to WebSocket server
function connect() {
  console.log(`Connecting to ${WS_URL}...`);

  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('Connected to WebSocket server');
    promptCommand();
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('\nReceived message:');
      console.log(JSON.stringify(message, null, 2));

      if (message.type === 'auth_success') {
        userId = message.userId;
        console.log(`\nAuthenticated as user: ${userId}`);
      }

      promptCommand();
    } catch (error) {
      console.error('Error parsing message:', error);
      promptCommand();
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from WebSocket server');
    process.exit(0);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    process.exit(1);
  });
}

// Send a command to the WebSocket server
function sendCommand(command) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('Not connected to WebSocket server');
    return;
  }

  try {
    ws.send(JSON.stringify(command));
    console.log(`\nSent command: ${JSON.stringify(command)}`);
  } catch (error) {
    console.error('Error sending command:', error);
  }
}

// Prompt for the next command
function promptCommand() {
  console.log('\n\x1b[32m%s\x1b[0m', '--- WebSocket Test Commands ---');
  console.log('1. Authenticate (auth)');
  console.log('2. Send Message (message)');
  console.log('3. Check Progress (progress)');
  console.log('4. Mint NFT (mint_nft)');
  console.log('5. Discord Setup (discord_setup)');
  console.log('6. Check Discord Stats (check_discord_stats)');
  console.log('7. Exit (exit)');

  rl.question('\nEnter command number: ', (answer) => {
    switch (answer.trim()) {
      case '1':
        authenticateCommand();
        break;
      case '2':
        messageCommand();
        break;
      case '3':
        progressCommand();
        break;
      case '4':
        mintNftCommand();
        break;
      case '5':
        discordSetupCommand();
        break;
      case '6':
        checkDiscordStatsCommand();
        break;
      case '7':
        console.log('Exiting...');
        process.exit(0);
        break;
      default:
        console.log('Invalid command');
        promptCommand();
        break;
    }
  });
}

// Command implementations
function authenticateCommand() {
  rl.question('Enter wallet address: ', (wallet) => {
    rl.question('Enter Privy ID (optional): ', (privyId) => {
      const command = {
        type: 'auth',
        wallet: wallet.trim(),
        privyId: privyId.trim() || undefined,
      };

      sendCommand(command);
    });
  });
}

function messageCommand() {
  rl.question('Enter message content: ', (content) => {
    const command = {
      type: 'message',
      content: content.trim(),
    };

    sendCommand(command);
  });
}

function progressCommand() {
  const command = {
    type: 'message',
    content: 'What is my current progress?',
  };

  sendCommand(command);
}

function mintNftCommand() {
  rl.question('Enter NFT type (idea/hypothesis): ', (type) => {
    const nftType = type.trim().toLowerCase();

    if (nftType !== 'idea' && nftType !== 'hypothesis') {
      console.log('Invalid NFT type. Must be "idea" or "hypothesis"');
      promptCommand();
      return;
    }

    const command = {
      type: 'mint_nft',
      nftType,
    };

    sendCommand(command);
  });
}

function discordSetupCommand() {
  rl.question('Enter Discord invite link or server ID: ', (inviteLink) => {
    const command = {
      type: 'discord_setup',
      content: inviteLink.trim(),
    };

    sendCommand(command);
  });
}

function checkDiscordStatsCommand() {
  const command = {
    type: 'check_discord_stats',
  };

  sendCommand(command);
}

// Start the application
connect();
