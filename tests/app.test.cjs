const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

function createApp(savedSettings = '{}') {
  const elements = new Map();
  function createElement() {
    const classes = new Set(['hidden']);
    return {
      value: '', textContent: '', innerHTML: '', dataset: {}, style: {}, children: [],
      listeners: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      appendChild(child) { this.children.push(child); },
      remove() {},
      click() {},
      select() {},
      reset() {}
    };
  }
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
      },
      createElement,
      body: createElement(),
      execCommand() { return false; }
    },
    window: {},
    localStorage: { getItem() { return savedSettings; }, setItem() {} },
    setTimeout(callback) { callback(); },
    clearTimeout() {},
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    Blob,
    console
  });
  vm.runInContext(source, context);
  context.window.onload();
  return { app: context, elements };
}

test('seed data renders and malformed stored payment settings stay blank', () => {
  const { elements } = createApp('{"venmo":42,"paypal":" valid "}');
  assert.equal(elements.get('stat-total-items').textContent, 9);
  assert.equal(elements.get('summary-standard-total').textContent, '$361.61');
  assert.equal(elements.get('venmo-handle').value, '');
  assert.equal(elements.get('paypal-handle').value, 'valid');
  assert.doesNotThrow(() => createApp('null'));
  assert.doesNotThrow(() => createApp('{invalid'));
});

test('CSV preserves apostrophes, escaped quotes, commas, and multiline fields', () => {
  const { app } = createApp();
  const data = app.parseCSV(
    '\uFEFFItem Name,Buyer,Cost,Receipt Name\r\n' +
    '"Dress, ""pink""\nlong",O\'Brien,"$1,234.50",Tag\r\n'
  );
  assert.equal(data.length, 1);
  assert.equal(data[0].buyer, "O'Brien");
  assert.equal(data[0].itemName, 'Dress, "pink"\nlong');
  assert.equal(data[0].cost, 1234.5);
  assert.equal(data[0].tax, 0);
});

test('exact aliases and optional columns do not reuse unrelated values', () => {
  const { app } = createApp();
  const [item] = app.parseCSV('Product,Customer,Commission,Price\nDress,Buyer,20,100');
  assert.equal(item.buyer, 'Buyer');
  assert.equal(item.itemName, 'Dress');
  assert.equal(item.cost, 100);
  assert.equal(item.tax, 0);
  assert.equal(item.findersFee, 20);
});

test('invalid CSV and monetary values are rejected without replacing purchases', () => {
  const { app, elements } = createApp();
  for (const csv of [
    'Buyer,Item Name,Cost\nA,Dress,abc',
    'Buyer,Item Name,Cost\nA,Dress,-1',
    'Buyer,Item Name,Cost\nA,Dress,1.234',
    'Buyer,Item Name,Cost\nA,Dress,1e3',
    'Buyer,Item Name,Cost\nA,Dress,"12,34"',
    'Buyer,Item Name,Cost\nA,Dress,999999999999999999999999',
    'Item Name,Cost\nDress,1',
    'Buyer,Item Name,Cost\nA,Dress',
    'Buyer,Item Name,Cost\n,Dress,1',
    'Buyer,Item Name,Cost\n"A,Dress,1',
    'Buyer,Item Name,Cost\n"A"x,Dress,1'
  ]) {
    assert.throws(() => app.parseCSV(csv));
    app.importPurchases(csv);
    assert.equal(elements.get('inv-buyer-name').textContent, 'Emma Vance');
    assert.equal(elements.get('stat-total-items').textContent, 9);
  }
});

test('invoice, Messenger, and overview use consistent cent-rounded totals', () => {
  const { app, elements } = createApp();
  elements.get('buyer-search-input').value = 'old filter';
  app.importPurchases('Buyer,Item Name,Cost\nA,Dress,1.50');
  assert.equal(elements.get('buyer-search-input').value, '');
  assert.equal(elements.get('summary-fee-amount').textContent, '+ $0.05 protection fee');
  assert.equal(elements.get('summary-protected-total').textContent, '$1.55');
  assert.equal(elements.get('stat-total-sales').textContent, '$1.50');
  assert.match(app.generateMessengerReceipt('A'), /\$1.55 \(includes \+\$0.05 fee\)/);
  const totals = app.calculateTotals(Array.from({ length: 10 }, () => ({
    cost: 0.1, tax: 0.2, findersFee: 0
  })));
  assert.equal(totals.standardTotal, 3);
  assert.equal(totals.protectedTotal, 3.09);
});

test('buyer IDs are distinct and user-entered HTML is rendered as text', () => {
  const { app, elements } = createApp();
  app.importPurchases(
    'Buyer,Item Name,Cost,Receipt Name\n' +
    '<img src=x>,<b>Dress</b>,1,<script>bad</script>\n' +
    'Ann Lee,Dress,1,Tag\nAmy Long,Dress,1,Tag'
  );
  const buyers = app.getUniqueBuyers();
  assert.equal(new Set(buyers.map(buyer => buyer.invoiceId)).size, 3);
  assert.match(elements.get('buyer-list').children.at(-3).innerHTML, /&lt;img src=x&gt;/);
  assert.match(elements.get('invoice-items-body').children.at(-1).innerHTML, /&lt;b&gt;Dress&lt;\/b&gt;/);
  assert.match(elements.get('invoice-items-body').children.at(-1).innerHTML, /&lt;script&gt;/);
  assert.equal(app.escapeCSV('=SUM(1,2)'), '"\'=SUM(1,2)"');
  assert.equal(app.escapeCSV('Normal "Name"'), '"Normal ""Name"""');
});

test('both archive formats keep sanitized and case-insensitive filename collisions', () => {
  const { app } = createApp();
  for (const [prefix, extension] of [['Invoice', 'pdf'], ['Receipt', 'txt']]) {
    const usedNames = new Set();
    const names = ['Ann Lee', 'Ann/Lee', 'Ann?Lee', 'ann lee', 'Ann_Lee_2']
      .map(name => app.getArchiveFileName(name, prefix, extension, usedNames));
    assert.equal(new Set(names.map(name => name.toLowerCase())).size, 5);
    assert.equal(names[1], `${prefix}_Ann_Lee_2.${extension}`);
  }
});

test('clipboard failure and missing PDF dependencies are reported without success', async () => {
  const { app, elements } = createApp();
  assert.equal(await app.copyText('receipt'), false);
  assert.match(elements.get('toast-message').textContent, /Could not copy/);
  await elements.get('btn-bulk-pdf').listeners.click();
  assert.match(elements.get('toast-message').textContent, /libraries are not loaded/);
  assert.equal(app.document.getElementById('modal-bulk-progress').classList.contains('hidden'), true);
});

test('bulk PDFs contain every canvas slice, keep colliding buyers, and restore selection', async () => {
  const { app, elements } = createApp();
  const pdfs = [];
  const files = [];
  app.window.jspdf = {
    jsPDF: class {
      constructor() {
        this.images = [];
        this.pages = 1;
        this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
        pdfs.push(this);
      }
      addPage() { this.pages++; }
      addImage(...args) { this.images.push(args); }
      output() { return new Blob(['pdf']); }
    }
  };
  app.JSZip = class {
    file(name) { files.push(name); }
    async generateAsync() { return new Blob(['zip']); }
  };
  app.html2canvas = async () => ({ width: 100, height: 400 });
  const createElement = app.document.createElement;
  const slices = [];
  app.document.createElement = tag => {
    if (tag !== 'canvas') return createElement();
    return {
      getContext() { return { drawImage(...args) { slices.push(args.slice(1, 5)); } }; },
      toDataURL() { return 'data:image/jpeg;base64,test'; }
    };
  };
  app.importPurchases('Buyer,Item Name,Cost\nAnn Lee,Dress,1\nAnn/Lee,Dress,2');
  await elements.get('btn-bulk-pdf').listeners.click();
  assert.equal(pdfs.length, 2);
  assert.equal(pdfs[0].pages, 3);
  assert.equal(pdfs[0].images.length, 3);
  assert.deepEqual(slices.slice(0, 3), [[0, 0, 100, 141], [0, 141, 100, 141], [0, 282, 100, 118]]);
  assert.deepEqual(files, ['Invoice_Ann_Lee.pdf', 'Invoice_Ann_Lee_2.pdf']);
  assert.equal(elements.get('inv-buyer-name').textContent, 'Ann Lee');
  assert.equal(elements.get('modal-bulk-progress').classList.contains('hidden'), true);
});

test('bulk PDF rendering failures restore the buyer and dismiss progress', async () => {
  const { app, elements } = createApp();
  app.console = { error() {} };
  app.window.jspdf = { jsPDF: class {} };
  app.JSZip = class {};
  app.html2canvas = async () => { throw new Error('Canvas failed'); };
  app.importPurchases('Buyer,Item Name,Cost\nFirst,Dress,1\nSecond,Dress,2');
  elements.get('buyer-list').children.at(-1).onclick();
  await elements.get('btn-bulk-pdf').listeners.click();
  assert.equal(elements.get('inv-buyer-name').textContent, 'Second');
  assert.equal(elements.get('modal-bulk-progress').classList.contains('hidden'), true);
  assert.match(elements.get('toast-message').textContent, /Error creating bulk PDFs/);
});
