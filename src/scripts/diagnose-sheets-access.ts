#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import { getGoogleAccessToken } from '../services/sheets-sync.service';
import axios from 'axios';

// Load environment variables
dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;

/**
 * Diagnostic script to identify Google Sheets access issues
 */
async function diagnoseSheetAccess(): Promise<void> {
  console.log('🔍 Google Sheets Access Diagnostic Tool');
  console.log('=======================================');
  
  // Step 1: Check environment variables
  console.log('\n📋 STEP 1: Checking environment variables');
  
  if (!SPREADSHEET_ID) {
    console.error('❌ GOOGLE_SHEET_ID is not set in your .env file!');
    console.error('💡 Add GOOGLE_SHEET_ID=your_spreadsheet_id to your .env file');
    process.exit(1);
  } else {
    console.log(`✅ GOOGLE_SHEET_ID is set: ${SPREADSHEET_ID.substring(0, 5)}...${SPREADSHEET_ID.substring(SPREADSHEET_ID.length - 5)}`);
  }
  
  if (!SERVICE_ACCOUNT_JSON) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not set in your .env file!');
    console.error('💡 Add GOOGLE_SERVICE_ACCOUNT_CREDENTIALS=your_json to your .env file');
    process.exit(1);
  } else {
    console.log('✅ GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is set');
    
    // Try to parse JSON to validate
    try {
      const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
      console.log(`📧 Service Account Email: ${credentials.client_email || 'Not found in credentials'}`);
      console.log('✅ Credentials JSON is valid');
    } catch (error) {
      console.error('❌ GOOGLE_SERVICE_ACCOUNT_CREDENTIALS contains invalid JSON!');
      console.error(`💡 Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  
  // Step 2: Get access token
  console.log('\n📋 STEP 2: Getting access token');
  
  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
    console.log('✅ Successfully obtained access token');
  } catch (error) {
    console.error('❌ Failed to get access token!');
    console.error(`💡 Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  
  // Step 3: Check if spreadsheet exists
  console.log('\n📋 STEP 3: Checking if spreadsheet exists');
  console.log(`🔍 Looking for spreadsheet ID: ${SPREADSHEET_ID}`);
  
  let spreadsheetExists = false;
  let spreadsheetTitle = '';
  
  try {
    const spreadsheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=properties`;
    const response = await axios.get(spreadsheetUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    spreadsheetExists = true;
    spreadsheetTitle = response.data.properties?.title || 'Unknown title';
    console.log(`✅ Spreadsheet found! Title: "${spreadsheetTitle}"`);
  } catch (error) {
    console.error('❌ Could not access spreadsheet!');
    
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.error(`💡 Spreadsheet ID ${SPREADSHEET_ID} doesn't exist.`);
      console.error('   Create a new spreadsheet and update your GOOGLE_SHEET_ID in .env');
    } else if (axios.isAxiosError(error) && error.response?.status === 403) {
      console.error('💡 Your service account doesn\'t have access to this spreadsheet.');
      console.error('   Share your spreadsheet with the service account email shown above.');
    } else {
      console.error(`💡 Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    process.exit(1);
  }
  
  // Step 4: Check if Projects sheet exists
  console.log('\n📋 STEP 4: Checking if "Projects" sheet exists');
  
  try {
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties`;
    const response = await axios.get(sheetsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    const sheets = response.data.sheets || [];
    console.log(`📊 Found ${sheets.length} sheets in the spreadsheet:`);
    
    const sheetNames = sheets.map((sheet: any) => sheet.properties?.title || 'Unnamed').join(', ');
    console.log(`📑 Sheet names: ${sheetNames}`);
    
    const projectsSheet = sheets.find((sheet: any) => sheet.properties?.title === 'Projects');
    
    if (projectsSheet) {
      console.log('✅ "Projects" sheet exists!');
    } else {
      console.error('❌ "Projects" sheet does not exist!');
      console.error('💡 Run the initialize-sheets.ts script to create it:');
      console.error('   npx ts-node src/scripts/initialize-sheets.ts');
    }
    
    // Try writing a test cell
    console.log('\n📋 STEP 5: Testing write access');
    
    try {
      // Try to write to cell A1 in a test sheet
      const testSheet = sheets[0]?.properties?.title || 'Sheet1';
      const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${testSheet}!A1?valueInputOption=RAW`;
      
      await axios.put(
        writeUrl,
        { values: [["Access test - " + new Date().toISOString()]] },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      
      console.log(`✅ Successfully wrote to sheet "${testSheet}"!`);
      console.log('💡 Your service account has write access to the spreadsheet.');
    } catch (error) {
      console.error('❌ Could not write to spreadsheet!');
      
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        console.error('💡 Your service account doesn\'t have WRITE access.');
        console.error('   Make sure you shared with EDITOR permissions.');
      } else {
        console.error(`💡 Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Could not get sheet information!');
    console.error(`💡 Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  console.log('\n📋 DIAGNOSIS SUMMARY');
  console.log('==================');
  
  if (spreadsheetExists) {
    console.log(`✅ Spreadsheet "${spreadsheetTitle}" (${SPREADSHEET_ID}) exists`);
    
    console.log('\n💡 RECOMMENDATION:');
    console.log('1. Make sure you\'ve run the initialize-sheets.ts script:');
    console.log('   npx ts-node src/scripts/initialize-sheets.ts');
    console.log('2. Check that your service account has EDITOR access to the spreadsheet');
    console.log('3. Verify that the "Projects" sheet exists with correct column headers');
  } else {
    console.log('❌ Could not access spreadsheet');
    
    console.log('\n💡 RECOMMENDATION:');
    console.log('1. Create a new Google Spreadsheet');
    console.log('2. Share it with your service account email with EDITOR permissions');
    console.log('3. Update your GOOGLE_SHEET_ID in .env with the new spreadsheet ID');
    console.log('4. Run the initialize-sheets.ts script');
  }
}

// Run the diagnostic
diagnoseSheetAccess().catch(console.error); 