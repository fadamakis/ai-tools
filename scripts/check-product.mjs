import {buildProduct,products,testProduct,testUiProduct} from './product-checks.mjs';

const [mode,product,...args]=process.argv.slice(2);
if(!['verify','ui'].includes(mode)||!products.includes(product)||mode==='verify'&&args.length)
  throw Error('Use verify or ui with one of shelob, workbench, sauron. Only ui accepts Playwright arguments.');
buildProduct(product);
if(mode==='verify')testProduct(product);
testUiProduct(product,args[0]==='--'?args.slice(1):args);
