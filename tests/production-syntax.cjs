const fs=require('node:fs');
const path=require('node:path');
const parser=require('@babel/parser');
const root=path.resolve(__dirname,'..');
const files=['src/pages/Production.jsx','src/components/ProductionCatalog.jsx','src/components/RecipePackingFields.jsx','src/production/model.mjs','src/production/translations.js','src/catalog/productionExport.mjs','src/App.jsx'];
for(const file of files) {
 const code=fs.readFileSync(path.join(root,file),'utf8');
 parser.parse(code,{sourceType:'module',plugins:['jsx']});
 if(code.includes('\ufffd'))throw Error('Invalid text encoding: '+file);
 console.log('Syntax and UTF-8 verified:',file);
}
