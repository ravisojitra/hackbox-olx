import { ModuleMetaData } from '..';
import { transform } from '@babel/standalone';
import { getModuleMetaData, getDirectoryName } from '../../utils/utils';
import * as comlink from 'comlink';

// TODO: these typing are fucking useless make them better
export interface BabelTypes {
  identifier: (id: string) => object;
  functionExpression: (
    id: any,
    params: any,
    body: any,
    generator: any,
    async: any
  ) => object;
}

export function babelPlugin(
  fileMetaData: ModuleMetaData
): ({ types }: { types: BabelTypes }) => object {
  return ({ types }): object => {
    return {
      visitor: {
        ImportDeclaration(path: any): void {
          const containingDirectoryName = getDirectoryName(fileMetaData.path);
          const depMetaData = getModuleMetaData(
            path.node.source.value,
            containingDirectoryName
          );
          fileMetaData.deps?.push(depMetaData);

          // check if there are any default imports
          const defaultImport = path.node.specifiers.find(
            (specifier: { type: string }) =>
              specifier.type === 'ImportDefaultSpecifier'
          );

          /*
          import hello from './hello.js';
  
          hello();
          ==============================
          above code is transformed into
          ==============================
          var hello$ = HELLO.___default;
          
          hello$();
          */
          if (defaultImport) {
            const localVariableName = `${defaultImport.local.name}$`;

            path.scope.push({
              id: types.identifier(localVariableName),
              init: types.identifier(`${depMetaData.canocialName}.___default`)
            });

            path.scope.rename(defaultImport.local.name, localVariableName);
          }
          // check if there are any named imports and transform them
          const namedImports = path.node.specifiers.filter(
            (specifier: { type: string }) =>
              specifier.type === 'ImportSpecifier'
          );

          /*
          import { hello as something } from './hello.js';
  
          something();
          ==============================
          above code is transformed into
          ==============================
          var something$ = HELLO.hello;

          something$();
          */
          for (const namedImport of namedImports) {
            // namedImport.local.name => something
            // namedImport.imported.name => hello
            const localVariableName = `${namedImport.local.name}$`;

            path.scope.push({
              id: types.identifier(localVariableName),
              init: types.identifier(
                `${depMetaData.canocialName}.${namedImport.imported.name}`
              )
            });

            path.scope.rename(namedImport.local.name, localVariableName);
          }

          path.remove();
        },
        ExportDefaultDeclaration(path: any): void {
          if (fileMetaData.exports === undefined) {
            fileMetaData.exports = {
              ___default: ''
            };
          }

          const declaration = path.node.declaration;

          if (declaration.type === 'Identifier') {
            fileMetaData.exports.___default = path.node.declaration.name;
          } else if (declaration.type === 'FunctionDeclaration') {
            const uid = path.scope.generateUidIdentifier('defaultExportFunc');

            path.scope.push({
              id: uid,
              init: types.functionExpression(
                declaration.id,
                declaration.params,
                declaration.body,
                declaration.generator,
                declaration.async
              )
            });

            fileMetaData.exports.___default = uid.name;
          }
          /*
          function hello() {
            console.log('hello world');
          }
  
          export default hello;
          ==============================
          above code is transformed into
          ==============================
          function hello() {
            console.log('hello world');
          }
          */
          path.remove();
        },
        ExportNamedDeclaration(path: any): void {
          if (fileMetaData.exports === undefined) {
            fileMetaData.exports = {
              ___default: ''
            };
          }
          // check if there are any named exports and transform them
          const namedExports = path.node.specifiers.filter(
            (specifier: { type: string }) =>
              specifier.type === 'ExportSpecifier'
          );

          /*
          function hello() {
            console.log('hello world');
          }
  
          export { hello as something };
          ==============================
          above code is transformed into
          ==============================
          function hello() {
            console.log('hello world');
          }
          */
          for (const namedExport of namedExports) {
            // namedExport.local.name => hello
            // nmaedExport.exported.name => something
            fileMetaData.exports[namedExport.exported.name] =
              namedExport.local.name;
          }

          path.remove();
        }
      }
    };
  };
}

export function babelTransform(
  fileContent: string,
  moduleMetaData: ModuleMetaData
) {
  const transformedCode = (transform(fileContent, {
    presets: ['es2015', 'react'],
    plugins: [babelPlugin(moduleMetaData)]
  }) as any).code;

  return {
    transformedCode,
    hydratedModuleMetaData: moduleMetaData
  };
}

comlink.expose({
  babelTransform
});
