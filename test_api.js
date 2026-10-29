const { Project, SyntaxKind } = require('ts-morph');
const project = new Project({compilerOptions:{allowJs:true}});
project.addSourceFileAtPath('demo/dummy_code.ts');
const sf = project.getSourceFiles()[0];
const funcs = [
  ...sf.getFunctions(),
  ...sf.getVariableDeclarations().filter(v => v.getInitializerIfKind(SyntaxKind.ArrowFunction) || v.getInitializerIfKind(SyntaxKind.FunctionExpression)),
  ...sf.getClasses().flatMap(c => c.getMethods())
];
for (const f of funcs) {
  let name = null;
  if (f.getNameNode) name = f.getNameNode();
  else if (f.getName) name = f.getNameNode ? f.getNameNode() : null;
  
  if (name) {
    const refs = name.findReferencesAsNodes();
    console.log(name.getText(), refs.length);
  }
}
