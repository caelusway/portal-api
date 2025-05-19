/**
 * Google Credentials Validation Tool
 * 
 * This script checks if the Google service account credentials are properly configured
 * and attempts to authenticate with Google's APIs.
 */

import dotenv from 'dotenv';
import { JWT } from 'google-auth-library';

dotenv.config();

async function validateGoogleCredentials() {
  console.log('🔍 Google Service Account Credentials Check');
  console.log('-------------------------------------------');
  
  // Check if the environment variable exists
  const SERVICE_ACCOUNT_JSON_STRING = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
  if (!SERVICE_ACCOUNT_JSON_STRING) {
    console.error('❌ ERROR: GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable is not defined');
    console.error('Please set this variable in your .env file with valid Google service account credentials JSON.');
    process.exit(1);
  }
  
  console.log('✅ GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable is defined');
  
  // Check if the string appears to be valid JSON
  try {
    const firstChar = SERVICE_ACCOUNT_JSON_STRING.trim()[0];
    const lastChar = SERVICE_ACCOUNT_JSON_STRING.trim()[SERVICE_ACCOUNT_JSON_STRING.trim().length - 1];
    
    if (firstChar !== '{' || lastChar !== '}') {
      console.error('❌ ERROR: The credentials string does not appear to be valid JSON');
      console.error(`It should start with '{' and end with '}', but it starts with '${firstChar}' and ends with '${lastChar}'`);
      
      // Display first 30 characters to help diagnose
      console.error('\nFirst 30 characters of credential string:');
      console.error(SERVICE_ACCOUNT_JSON_STRING.substring(0, 30) + '...');
      
      // Display last 30 characters
      console.error('\nLast 30 characters of credential string:');
      console.error('...' + SERVICE_ACCOUNT_JSON_STRING.substring(SERVICE_ACCOUNT_JSON_STRING.length - 30));
      
      process.exit(1);
    }
    
    console.log('✅ Credentials string appears to be in JSON format');
    
    // Try to parse the JSON
    let creds;
    try {
      creds = JSON.parse(SERVICE_ACCOUNT_JSON_STRING);
      console.log('✅ Credentials JSON parsed successfully');
      
      // Check required fields
      if (!creds.client_email) {
        console.error('❌ ERROR: Parsed credentials are missing "client_email" field');
        console.error('Available fields:', Object.keys(creds).join(', '));
        process.exit(1);
      }
      
      if (!creds.private_key) {
        console.error('❌ ERROR: Parsed credentials are missing "private_key" field');
        console.error('Available fields:', Object.keys(creds).join(', '));
        process.exit(1);
      }
      
      console.log('✅ Required fields found in credentials JSON');
      console.log(`   • client_email: ${creds.client_email}`);
      console.log('   • private_key: [Present]');
      
      // Test authentication with Google
      console.log('\n🔄 Testing authentication with Google...');
      const client = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      try {
        const token = await client.authorize();
        if (token.access_token) {
          console.log('✅ Successfully authenticated with Google!');
          console.log(`   • Token obtained: ${token.access_token.substring(0, 10)}...`);
          console.log(`   • Token expires: ${token.expiry_date ? new Date(token.expiry_date).toLocaleString() : 'Unknown'}`);
        } else {
          console.error('❌ ERROR: Authentication successful but no access token returned');
        }
      } catch (authError) {
        console.error('❌ ERROR: Failed to authenticate with Google:', authError);
        process.exit(1);
      }
      
    } catch (jsonError) {
      console.error('❌ ERROR: Failed to parse credentials JSON:', jsonError);
      
      // Show a more detailed analysis of the string
      console.error('\nAnalyzing JSON string issues:');
      const jsonErrMsg = jsonError instanceof Error ? jsonError.message : String(jsonError);
      
      if (jsonErrMsg.includes('position')) {
        // Try to show the character around the error position
        const posMatch = jsonErrMsg.match(/position (\d+)/);
        if (posMatch && posMatch[1]) {
          const pos = parseInt(posMatch[1], 10);
          const start = Math.max(0, pos - 10);
          const end = Math.min(SERVICE_ACCOUNT_JSON_STRING.length, pos + 10);
          
          console.error(`Error around position ${pos}:`);
          console.error(SERVICE_ACCOUNT_JSON_STRING.substring(start, pos) + ' 👉 ' + 
                        SERVICE_ACCOUNT_JSON_STRING.substring(pos, pos+1) + ' 👈 ' + 
                        SERVICE_ACCOUNT_JSON_STRING.substring(pos+1, end));
          
          // Check for common issues
          if (SERVICE_ACCOUNT_JSON_STRING.includes('\\n')) {
            console.error('\nNOTE: Your JSON string contains "\\n" literals. Make sure these are properly escaped newlines in the string, not literal "\\n" characters.');
          }
          
          if (SERVICE_ACCOUNT_JSON_STRING.includes('\\"')) {
            console.error('\nNOTE: Your JSON string contains "\\"" sequences. This suggests double escaping, which can cause parsing issues.');
          }
        }
      }
      
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Unexpected error during validation:', error);
    process.exit(1);
  }
  
  console.log('\n✨ Validation complete - All checks passed!');
}

// Run the validation
validateGoogleCredentials().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 