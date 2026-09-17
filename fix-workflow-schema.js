const fs = require('fs');
const path = require('path');
const { db } = require('./src/database/db');

async function fixSchema() {
  const workflows = db.find('workflows');
  let fixed = 0;
  
  for (const wf of workflows) {
    if (wf.recordingData) {
      // It's a migrated workflow
      const updates = {};
      
      if (!wf.targetUrl && wf.recordingData.metadata && wf.recordingData.metadata.startUrl) {
        updates.targetUrl = wf.recordingData.metadata.startUrl;
      }
      
      if (!wf.steps && wf.recordingData.actions) {
        updates.steps = wf.recordingData.actions;
      }
      
      if (Object.keys(updates).length > 0) {
        db.update('workflows', wf.id, updates);
        fixed++;
      }
    }
  }
  
  console.log(`Fixed schema for ${fixed} workflows.`);
}

fixSchema();
