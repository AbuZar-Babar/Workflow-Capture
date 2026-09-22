/**
 * DevExpress Toolbar & Iframe Capture Test
 */
const assert = require('assert');
const SelectorResolver = require('../src/shared/selector-resolver');

console.log('🧪 Starting DevExpress Toolbar & Iframe Selector Unit Tests...\n');

// Test 1: Generate candidates for DevExpress Save to Disk toolbar icon
console.log('🔹 Test 1: DevExpress Save to Disk Image Candidate Generation');
{
  const mockSaveImg = {
    nodeType: 1,
    tagName: 'IMG',
    id: 'PaymentReceipt_Splitter_Toolbar_Menu_DXI9_Img',
    className: 'dxXtraReports_BtnSave_Mulberry dxm-image dx-vam',
    parentElement: {
      nodeType: 1,
      tagName: 'LI',
      id: 'PaymentReceipt_Splitter_Toolbar_Menu_DXI9_',
      className: 'dxm-item',
      hasAttribute: (a) => a === 'title' || a === 'id',
      getAttribute: (a) => a === 'title' ? 'Export a report and save it to the disk' : 'PaymentReceipt_Splitter_Toolbar_Menu_DXI9_',
      closest: () => null
    },
    hasAttribute: (a) => a === 'title' || a === 'id' || a === 'src',
    getAttribute: (a) => {
      if (a === 'title') return 'Export a report and save it to the disk';
      if (a === 'id') return 'PaymentReceipt_Splitter_Toolbar_Menu_DXI9_Img';
      if (a === 'src') return '/iRelyProd/DXR.axd?r=1_32-dAAts';
      return null;
    },
    getBoundingClientRect: () => ({ width: 16, height: 16, top: 20, left: 100 }),
    closest: (sel) => {
      if (sel.includes('.dxm-item')) {
        return mockSaveImg.parentElement;
      }
      return null;
    }
  };

  // Mock document querySelectorAll and queryXPath
  const mockDoc = {
    querySelectorAll: () => [mockSaveImg],
    evaluate: () => ({
      snapshotLength: 0,
      snapshotItem: () => null
    })
  };

  const target = SelectorResolver.captureTarget(mockSaveImg, mockDoc);
  assert(target && target.candidates && target.candidates.length > 0, 'Should generate candidates');
  
  const values = target.candidates.map(c => c.value);
  console.log('  Generated candidates:', values.slice(0, 5));

  // Should contain exact title match or action keyword match
  const hasExactTitle = values.some(v => v.includes('title="Export a report and save it to the disk"'));
  const hasSaveKeyword = values.some(v => v.includes('title*="save"'));
  const hasParentLi = values.some(v => v.includes('li[title='));

  assert(hasExactTitle, 'Should generate exact title candidate: img[title="..."]');
  assert(hasSaveKeyword, 'Should generate action keyword candidate: img[title*="save" i]');
  assert(hasParentLi, 'Should generate parent .dxm-item candidate: li[title=...]');
  console.log('  ✅ DevExpress save button candidates passed!\n');
}

// Test 2: DevExpress Save in Window Image Candidate Generation
console.log('🔹 Test 2: DevExpress Save in Window Candidate Generation');
{
  const mockWindowImg = {
    nodeType: 1,
    tagName: 'IMG',
    id: 'PaymentReceipt_Splitter_Toolbar_Menu_DXI10_Img',
    className: 'dxXtraReports_BtnSaveWindow_Mulberry dxm-image dx-vam',
    parentElement: {
      nodeType: 1,
      tagName: 'LI',
      id: 'PaymentReceipt_Splitter_Toolbar_Menu_DXI10_',
      className: 'dxm-item',
      hasAttribute: (a) => a === 'title',
      getAttribute: (a) => a === 'title' ? 'Export a report and show it in a new window' : null,
      closest: () => null
    },
    hasAttribute: (a) => a === 'title' || a === 'id',
    getAttribute: (a) => {
      if (a === 'title') return 'Export a report and show it in a new window';
      if (a === 'id') return 'PaymentReceipt_Splitter_Toolbar_Menu_DXI10_Img';
      return null;
    },
    getBoundingClientRect: () => ({ width: 16, height: 16, top: 20, left: 130 }),
    closest: (sel) => {
      if (sel.includes('.dxm-item')) {
        return mockWindowImg.parentElement;
      }
      return null;
    }
  };

  const mockDoc = {
    querySelectorAll: () => [mockWindowImg],
    evaluate: () => ({ snapshotLength: 0, snapshotItem: () => null })
  };

  const target = SelectorResolver.captureTarget(mockWindowImg, mockDoc);
  const values = target.candidates.map(c => c.value);
  console.log('  Generated window candidates:', values.slice(0, 5));

  const hasExportMatch = values.some(v => v.includes('title*="export"'));
  assert(hasExportMatch, 'Should generate export action candidate');
  console.log('  ✅ DevExpress window save candidates passed!\n');
}

console.log('🎉 ALL DEVEXPRESS TOOLBAR TESTS PASSED SUCCESSFULLY!\n');
