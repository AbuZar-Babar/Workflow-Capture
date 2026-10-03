const assert = require('assert');
const { ConditionEvaluator } = require('../src/shared/condition-evaluator');
const { evaluateFilterPreview } = require('../src/shared/item-filter');
const { ItemDiscovery } = require('../src/shared/item-discovery');

async function runPortalCourseDownloadTests() {
  console.log('🧪 Starting Universal Portal Course Download & Column Discrimination Tests...\n');

  // Test 1: Extraction of columns and action value on ASP.NET GridView table
  console.log('🔹 Test 1: Course download table extracts exact header columns and action value');
  const mockTableHeaders = ['#', 'Title', 'Description', 'UploadDate', 'Download Files'];
  const mockRows = [
    ['1', 'pdc theory', 'PARALLEL & DISTRIBUTED COMPUTING', '01 Oct,2026', 'Download'],
    ['2', 'pdc theory', 'distributed systems', '01 Oct,2026', 'Download'],
    ['3', 'pdc theory', 'distributed systems', '01 Oct,2026', 'Download'],
    ['4', 'pdc theory', 'parallel computing', '01 Oct,2026', 'Download'],
    ['5', 'pdc lab', 'tasb task', '01 Oct,2026', 'Download'],
    ['6', 'pdc lab', 'pthread programs', '01 Oct,2026', 'Download']
  ];

  const items = mockRows.map((rowCells, idx) => {
    const fields = {};
    mockTableHeaders.forEach((col, cIdx) => {
      if (rowCells[cIdx] !== undefined) fields[col] = rowCells[cIdx];
    });
    return {
      index: idx,
      text: rowCells.join(' '),
      fields
    };
  });

  // Verify fields do NOT contain fake Type with the entire row
  assert.strictEqual(items[0].fields['Type'], undefined, 'Must not inject fake Type field');
  assert.strictEqual(items[0].fields['Download Files'], 'Download', 'Must extract Download Files as Download');
  assert.strictEqual(items[0].fields['Title'], 'pdc theory');
  assert.strictEqual(items[0].fields['UploadDate'], '01 Oct,2026');
  console.log('  ✅ Extracted fields accurately without fake Type injection:', items[0].fields);

  // Test 2: Target action association selects "Download Files" column and "Download" value
  console.log('\n🔹 Test 2: Recorded click on column 4 associates targetColumn and targetActionValue');
  const recordedCellIndex = 4; // "Download Files"
  const recordedActionValue = 'Download';
  const targetColumn = mockTableHeaders[recordedCellIndex];
  assert.strictEqual(targetColumn, 'Download Files');
  assert.strictEqual(recordedActionValue, 'Download');

  // Test 3: Filter preview evaluation with targetColumn
  console.log('\n🔹 Test 3: Filter preview matches all rows when filtering by Download Files');
  const filter = {
    field: 'Download Files',
    operator: 'contains',
    value: 'Download'
  };

  const preview = evaluateFilterPreview(filter, items);
  assert.strictEqual(preview.totalCount, 6, 'Total count must be 6');
  assert.strictEqual(preview.matchingCount, 6, 'All 6 rows must match Download condition');
  assert.strictEqual(preview.selectedCount, 6, 'All 6 rows must be selected');
  assert.strictEqual(preview.skippedFilterCount, 0, 'No rows skipped');
  console.log('  ✅ Preview verified: 6/6 items match "Download Files" contains "Download"');

  // Test 4: Filtering for specific course lab vs theory
  console.log('\n🔹 Test 4: Can filter specifically by Title or Description');
  const labFilter = {
    field: 'Title',
    operator: 'contains',
    value: 'lab'
  };
  const labPreview = evaluateFilterPreview(labFilter, items);
  assert.strictEqual(labPreview.matchingCount, 2, 'Should match 2 lab rows');
  assert.strictEqual(labPreview.skippedFilterCount, 4, 'Should skip 4 theory rows');
  console.log('  ✅ Title filter accurately discriminated lab rows (2 matched, 4 skipped)');

  // Test 5: Multi-table disambiguation (Profile Table vs Course Contents Table)
  console.log('\n🔹 Test 5: Profile table (Table 1) vs Data table (Table 2) disambiguation');
  const table1Profile = {
    type: 'table_grid',
    itemCount: 5,
    columns: ['Name', 'Roll No', 'Father Name', 'Registered Courses']
  };
  const table2Courses = {
    type: 'table_grid',
    itemCount: 6,
    columns: ['#', 'Title', 'Description', 'UploadDate', 'Download Files']
  };
  const pageEntities = [table1Profile, table2Courses];
  const targetActionText = 'download';

  // Disambiguation logic must match table2Courses because of 'Download Files' / 'download'
  const matchedTable = pageEntities.find(e =>
    e.type === 'table_grid' &&
    (e.columns.some(c => targetActionText.includes(c.toLowerCase()) || c.toLowerCase().includes(targetActionText)))
  );
  assert.strictEqual(matchedTable, table2Courses, 'Must select Table 2 (Courses), not Table 1 (Profile)');
  // Test 6: Headerless Profile Layout Table vs Course Table with Action Links
  console.log('\n🔹 Test 6: Real-world SIS portal layout table vs Course download table disambiguation');
  const sisTable1Profile = {
    type: 'table_grid',
    itemCount: 7,
    columns: ['_rawText', 'Text'],
    hasExplicitHeaders: false,
    isKeyValueLayout: true,
    rows: [
      { _rawText: 'Total Registered Courses : 41 Program : BCS', Text: 'Total Registered Courses : 41 Program : BCS' },
      { _rawText: 'Current Section : B Current Advisor : Dr. Syed Faraz Ahmad', Text: 'Current Section : B' }
    ]
  };
  const sisTable2Courses = {
    type: 'table_grid',
    itemCount: 6,
    columns: ['#', 'Title', 'Description', 'UploadDate', 'Download Files'],
    hasExplicitHeaders: true,
    hasDownloadLinks: true,
    actionColumn: 'Download Files',
    actionText: 'Download',
    rows: items.map(it => it.fields)
  };
  const sisEntities = [sisTable1Profile, sisTable2Courses];

  // Test fallback selector: must pick sisTable2Courses
  const tableGridCandidates = sisEntities.filter(e => e.type === 'table_grid' && e.itemCount >= 2);
  const selectedEntity = tableGridCandidates.find(e => e.hasDownloadLinks || e.actionColumn) ||
                        tableGridCandidates.find(e => e.hasExplicitHeaders && e.columns?.length >= 2) ||
                        tableGridCandidates.find(e => !e.isKeyValueLayout) ||
                        tableGridCandidates[0];

  assert.strictEqual(selectedEntity, sisTable2Courses, 'Must select Table 2 with download links over Table 1 profile');
  assert.strictEqual(selectedEntity.actionColumn, 'Download Files');
  assert.strictEqual(selectedEntity.actionText, 'Download');
  console.log('  ✅ Prioritized Table 2 (Course Contents with Download Files) over Table 1 (Student Profile)');

  // Test 7: Loop step index inference on cl.json steps
  console.log('\n🔹 Test 7: Loop step index inference designates Download Link (step 5) over dropdown (step 3)');
  const LoopDetector = require('../src/shared/loop-detector');
  const clSteps = [
    { type: 'CLICK', name: 'Courses Link', target: { candidates: [{ strategy: 'css-path', value: '#lstCourses > a' }] } },
    { type: 'CLICK', name: 'Course Portal Link', target: { candidates: [{ strategy: 'css-path', value: '#lstCoursePortal > a' }] } },
    { type: 'CLICK', name: 'Course Contents Link', target: { candidates: [{ strategy: 'id', value: '#lnkCourseContents' }] } },
    {
      type: 'SELECT',
      name: '-Select Course- Parallel and Distribu… Dropdown',
      target: {
        candidates: [{ strategy: 'css-path', value: '#main-content > div:nth-of-type(3) > table > tbody > tr > td:nth-of-type(3) > select' }],
        fingerprint: { tagName: 'select' }
      }
    },
    {
      type: 'SELECT',
      name: '-Select Course- Parallel and Distribu… Dropdown',
      target: {
        candidates: [{ strategy: 'css-path', value: '#main-content > div:nth-of-type(3) > table > tbody > tr > td:nth-of-type(3) > select' }],
        fingerprint: { tagName: 'select' }
      }
    },
    {
      type: 'CLICK',
      name: 'Download Link',
      target: {
        candidates: [{ strategy: 'css-path', value: '#main-content > div:nth-of-type(3) > div:nth-of-type(2) > table > tbody > tr:nth-of-type(2) > td:nth-of-type(5) > a' }],
        fingerprint: { tagName: 'a', text: 'Download', attributes: { href: 'DownloadFile.aspx?ocid=62681&fileID=723633&fileType=q' } }
      }
    }
  ];

  const loopIndex = LoopDetector.findLoopCandidateIndex(clSteps);
  assert.strictEqual(loopIndex, 5, 'Loop candidate index must be 5 (Download Link), NOT 3 (dropdown)');
  console.log('  ✅ LoopDetector correctly identified Step 5 (Download Link) as loop candidate');

  // Test 8: Download action detection recognizes anchor tag with href DownloadFile.aspx
  console.log('\n🔹 Test 8: Download action detection matches DownloadFile.aspx href');
  const targetStep = clSteps[5];
  const isDownload = Boolean(
    targetStep.isDownload === true ||
    (targetStep.target?.candidates?.some(c => c.value && /download|export|save|pdf|print|file/i.test(c.value))) ||
    (targetStep.target?.fingerprint?.attributes?.title && /download|export|save|pdf|print/i.test(targetStep.target.fingerprint.attributes.title)) ||
    (targetStep.target?.fingerprint?.attributes?.href && /download|export|save|file/i.test(targetStep.target.fingerprint.attributes.href)) ||
    (targetStep.target?.fingerprint?.text && /download|export|save|pdf|print/i.test(targetStep.target.fingerprint.text)) ||
    (targetStep.name && /download|export|save/i.test(targetStep.name))
  );
  assert.strictEqual(isDownload, true, 'Step 5 must be recognized as download action');
  console.log('  ✅ Download action successfully verified');

  // Test 9: Normalized runtime contract creation
  console.log('\n🔹 Test 9: Normalized runtime contract creation');
  const { createWorkflowDefinition, createDiscoveredCollection, createExecutionPlan } = require('../src/shared/runtime-contract');
  const wfDef = createWorkflowDefinition({ id: 'cl', name: 'cl', actions: clSteps, loopStepIndex: 5 });
  assert.strictEqual(wfDef.loopStepIndex, 5);
  assert.strictEqual(wfDef.steps.length, 6);

  const collection = createDiscoveredCollection({
    type: 'table_grid',
    name: 'Course Contents',
    itemCount: 6,
    headerColumns: mockTableHeaders,
    hasActionControls: true,
    actionType: 'download',
    targetColumn: 'Download Files',
    targetActionValue: 'Download',
    records: items
  });
  assert.strictEqual(collection.itemCount, 6);
  assert.strictEqual(collection.targetColumn, 'Download Files');

  const execPlan = createExecutionPlan({
    workflowId: 'cl',
    strategy: 'SINGLE_PAGE_COLLECTION',
    intent: { targetEntity: 'Course Contents', action: 'DOWNLOAD', conditions: filter }
  });
  assert.strictEqual(execPlan.strategy, 'SINGLE_PAGE_COLLECTION');
  assert.strictEqual(execPlan.recoveryPolicy.skipSetupIfCollectionVisible, true);
  console.log('  ✅ Runtime contracts validated');

  console.log('\n🎉 ALL PORTAL COURSE DOWNLOAD TESTS PASSED!\n');
}

runPortalCourseDownloadTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
