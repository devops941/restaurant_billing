const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function main() {
  const dir = path.join(__dirname, '..', 'templates');
  fs.mkdirSync(dir, { recursive: true });

  const menu = new ExcelJS.Workbook();
  const ms = menu.addWorksheet('Menu');
  ms.addRow(['Code', 'Category_EN', 'Category_TA', 'Item_EN', 'Item_TA', 'Price', 'Tax_Profile', 'Unit']);
  ms.addRow(['101', 'Biriyani', 'பிரியாணி', 'Chicken Biriyani', 'சிக்கன் பிரியாணி', 180, 'Restaurant 5%', 'Plate']);
  ms.addRow(['102', 'Biriyani', 'பிரியாணி', 'Mutton Biriyani', 'மட்டன் பிரியாணி', 260, '5', 'Plate']);
  await menu.xlsx.writeFile(path.join(dir, 'Menu_Template.xlsx'));

  const bills = new ExcelJS.Workbook();
  const bs = bills.addWorksheet('Bills');
  bs.addRow(['Date', 'Bill_No', 'Table/Type', 'Item_Code', 'Qty', 'Rate (optional)', 'Discount', 'Payment_Mode']);
  bs.addRow(['14-10-2026', 1, 'Dine-in T3', 101, 2, 0, 0, 'Cash']);
  bs.addRow(['14-10-2026', 1, 'Dine-in T3', 301, 4, 0, 0, 'Cash']);
  await bills.xlsx.writeFile(path.join(dir, 'Bill_Entry_Template.xlsx'));

  console.log('Templates written to templates/');
}

main();
