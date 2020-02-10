import { transform } from '@babel/standalone';
import { buildExecutableModules, run } from './index';
import { babelPlugin } from './workers/babel/babel';
import { ModuleMetaData } from '../bundler';
import { getModuleMetaData } from '../utils/utils';
import { FS } from '../services/fs/fs';
import { ModuleCache } from './services/module-cache/module-cache';

type BabelTransformType = (
  fileContent: string,
  moduleMetaData: ModuleMetaData
) => Promise<{
  transformedCode: string;
  hydratedModuleMetaData: ModuleMetaData;
}>;

type ComLinkType = {
  wrap(worker: {
    URL: string;
  }): { babelTransform: BabelTransformType } | undefined;
  expose(): void;
};

// jest does not support web workers so we need to simulate it
/* eslint-disable @typescript-eslint/no-empty-function */
jest.mock(
  'comlink',
  (): ComLinkType => {
    return {
      wrap: (worker: {
        URL: string;
      }): { babelTransform: BabelTransformType } | undefined => {
        /* eslint-disable @typescript-eslint/no-var-requires */
        const {
          babelTransform
        }: {
          babelTransform: BabelTransformType;
        } = require('./workers/babel/babel');

        if (worker.URL.includes('babel.worker.ts')) {
          return {
            babelTransform: (
              filecontent: string,
              moduleMetaData: ModuleMetaData
            ): Promise<{
              transformedCode: string;
              hydratedModuleMetaData: ModuleMetaData;
            }> => Promise.resolve(babelTransform(filecontent, moduleMetaData))
          };
        }
      },
      expose: (): void => {}
    };
  }
);

let someFileMetaData: ModuleMetaData;

describe('Babel plugin', () => {
  beforeEach(() => {
    someFileMetaData = getModuleMetaData('./hello.js');
    jest.resetAllMocks();
  });

  it('should update the default imports', () => {
    const code = `import welcome from './welcome';
    welcome();
    `;
    const expectedTransformedCode = `var welcome$ = WELCOME.default;
welcome$();`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('it should replace the import by variable declaration', () => {
    const someFileMetaData = getModuleMetaData('./hello.js');
    const code = `import counter from './counter.js'`;
    const expectedTransformedCode = `var counter$ = COUNTER.default;`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should update the named imports', () => {
    const code = `import { welcome } from './welcome';
    welcome();
    `;
    const expectedTransformedCode = `var welcome$ = WELCOME.welcome;
welcome$();`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should update the named imports with renames', () => {
    const code = `import { welcome as something } from './welcome';
    something();
    `;
    const expectedTransformedCode = `var something$ = WELCOME.welcome;
something$();`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should update fileMetadata with deps', () => {
    const code = `import dep1 from './modules/dep1';
      import dep2 from './modules/dep2';
      dep1();
      dep2();
      `;

    transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    });

    expect(someFileMetaData.deps).toEqual([
      getModuleMetaData('./modules/dep1'),
      getModuleMetaData('./modules/dep2')
    ]);
  });

  it('should return the exports as array', () => {
    const code = `const counter = 10, value = 2, renamedValue = 3;
    export { value, renamedValue as otherValue };
    export default counter;`;

    transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    });

    expect(someFileMetaData.exports).toEqual({
      default: 'counter',
      value: 'value',
      otherValue: 'renamedValue'
    });
  });

  it('should return the inline default export function', () => {
    const code = `export default function someName() { console.log('ha ha') }`;

    transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    });

    expect(someFileMetaData.exports).toEqual({
      default: '_defaultExportFunc'
    });
  });

  it('should remove default exports', () => {
    const code = `const counter = 10;
    export default counter;`;
    const expectedTransformedCode = `const counter = 10;`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should handle the anonymous default exports', () => {
    const code = `export default function someName() { console.log('ha ha') }`;
    const expectedTransformedCode = `var _defaultExportFunc = function someName() {
  console.log('ha ha');
};`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });

  it('should remove named exports', () => {
    const code = `const counter = 10;
    export { counter };`;
    const expectedTransformedCode = `const counter = 10;`;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const transformedCode = (transform(code, {
      presets: ['es2017'],
      plugins: [babelPlugin(someFileMetaData)]
    }) as any).code;

    expect(transformedCode).toBe(expectedTransformedCode);
  });
});

describe('buildExecutableModule()', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should create the function with required dependencies', async () => {
    const files = {
      './hello.js': `console.info('hello from hackbox');`
    };
    const fs = new FS(files);
    const module = (
      await buildExecutableModules(getModuleMetaData('./hello.js'), fs)
    ).module;

    console.info = jest.fn();
    module();

    expect(console.info).toHaveBeenCalledWith('hello from hackbox');
  });

  it('should return the default export', async () => {
    const files = {
      './hello.js': `function hello() { console.info('hello from export'); }
      export default hello;`
    };
    const fs = new FS(files);
    const module = (
      await buildExecutableModules(getModuleMetaData('./hello.js'), fs)
    ).module;

    console.info = jest.fn();
    const exports = module();
    // try running the default export
    exports.default();

    expect(console.info).toHaveBeenCalledWith('hello from export');
  });

  it('should run with a dependency injected', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from dep injection') }
      export default welcome;`,
      './hello.js': `import welcome from './welcome.js';
      welcome();`
    };
    const cache = ModuleCache.getInstance();
    const fs = new FS(files);
    const entryModule = (
      await buildExecutableModules(getModuleMetaData('./hello.js'), fs)
    ).module;

    console.info = jest.fn();
    // try running the module with the _WELCOME dependency
    const entryFunc = new Function(
      'entryModule',
      `entryModule(${cache.get('WELCOME')?.module}())`
    );

    entryFunc(entryModule);

    expect(console.info).toHaveBeenCalledWith('hello from dep injection');
  });
});

describe('run()', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // reset the cache
    ModuleCache.getInstance().reset();
  });

  it('should run the modules with default imports, exports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from default import/export modules') }
      export default welcome;`,
      './hello.js': `import welcome from './welcome.js';
      welcome();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from default import/export modules'
    );
  });

  it('should evaluate the module only once', async () => {
    const files = {
      './use-hello1.js': `import hello from './hello.js';
                          import something from './components/use-hello2.js'`,
      './components/use-hello2.js': `import hello from '../hello.js';`,
      './hello.js': `console.info("Hi I'm hello.js")`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './use-hello1.js');

    expect(console.info).toHaveBeenCalledWith("Hi I'm hello.js");
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it('should run the modules with named imports, exports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from named import/export modules') }
      export { welcome };`,
      './hello.js': `import { welcome } from './welcome.js';
      welcome();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from named import/export modules'
    );
  });

  it('should run the modules with renamed imports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from renamed import modules') }
      export { welcome };`,
      './hello.js': `import { welcome as hello } from './welcome.js';
      hello();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from renamed import modules'
    );
  });

  it('should run the modules with renamed exports', async () => {
    const files = {
      './welcome.js': `function welcome() { console.info('hello from renamed exports modules') }
      export { welcome as something };`,
      './hello.js': `import { something as hello } from './welcome.js';
      hello();`
    };
    const fs = new FS(files);

    console.info = jest.fn();
    await run(fs, './hello.js');

    expect(console.info).toHaveBeenCalledWith(
      'hello from renamed exports modules'
    );
  });
});
