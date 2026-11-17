import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const sourceRoot = resolve(__dirname, '../src');
const featureNames = new Set(['users', 'rooms', 'bookings', 'identity', 'health']);
const businessFeatures = new Set(['users', 'rooms', 'bookings']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

function localPath(path: string): string {
  return relative(sourceRoot, path).split(sep).join('/');
}

function importsOf(source: ts.SourceFile): Array<{ node: ts.Node; specifier: string }> {
  const imports: Array<{ node: ts.Node; specifier: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({ node, specifier: node.moduleSpecifier.text });
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ node, specifier: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function dependencyPath(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const candidate = resolve(dirname(file), specifier);
  const target = [`${candidate}.ts`, join(candidate, 'index.ts')].find(existsSync);
  if (!target) {
    throw new Error(`Unresolved local dependency: ${localPath(file)} -> ${specifier}`);
  }
  return localPath(target);
}

const sources = sourceFiles(sourceRoot).map((file) => ({
  file,
  path: localPath(file),
  source: ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
}));

describe('Architecture boundaries', () => {
  it('keeps business application code independent of HTTP, ORM and concrete adapters', () => {
    const violations: string[] = [];
    for (const { file, path, source } of sources) {
      if (!businessFeatures.has(path.split('/')[0]) || !path.includes('/application/')) {
        continue;
      }
      for (const { node, specifier } of importsOf(source)) {
        const target = dependencyPath(file, specifier);
        if (specifier === '@nestjs/common') {
          const bindings = ts.isImportDeclaration(node)
            ? node.importClause?.namedBindings
            : undefined;
          if (
            !bindings ||
            !ts.isNamedImports(bindings) ||
            bindings.elements.some(
              (binding) =>
                !['Inject', 'Injectable'].includes((binding.propertyName ?? binding.name).text),
            )
          ) {
            violations.push(`${path}: only Inject/Injectable are allowed from Nest`);
          }
        } else if (
          !target &&
          /^(?:@nestjs\/|typeorm(?:\/|$)|pg(?:\/|$)|express(?:\/|$)|passport|class-validator|class-transformer)/.test(
            specifier,
          )
        ) {
          violations.push(`${path} -> ${specifier}`);
        }
        if (
          target &&
          (target.includes('/presentation/') ||
            target.includes('/infrastructure/') ||
            target.startsWith('common/http/') ||
            target.startsWith('http/') ||
            target.startsWith('database/') ||
            target.startsWith('identity/') ||
            target.endsWith('.module.ts') ||
            target.endsWith('.dto.ts'))
        ) {
          violations.push(`${path} -> ${target}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('uses public contracts between features and keeps common independent of features', () => {
    const violations: string[] = [];
    for (const { file, path, source } of sources) {
      const owner = path.split('/')[0];
      for (const { specifier } of importsOf(source)) {
        const target = dependencyPath(file, specifier);
        if (!target || !featureNames.has(target.split('/')[0])) {
          continue;
        }
        if (owner === 'common') {
          violations.push(`${path} -> ${target}`);
          continue;
        }
        if (!featureNames.has(owner) || owner === target.split('/')[0]) {
          continue;
        }
        const publicContract = target.split('/')[1] === 'public';
        const moduleImport = path.endsWith('.module.ts') && target.endsWith('.module.ts');
        const transactionIntegration =
          path.startsWith('bookings/infrastructure/') &&
          target === 'rooms/infrastructure/public/rooms-transaction.factory.ts';
        if (!publicContract && !moduleImport && !transactionIntegration) {
          violations.push(`${path} -> ${target}`);
        }
        if (
          target.startsWith('identity/public/http/') &&
          !path.includes('/presentation/') &&
          !path.endsWith('.controller.ts')
        ) {
          violations.push(`${path}: Identity HTTP decorators belong to presentation`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps ports, models and public business contracts free of framework types', () => {
    const violations: string[] = [];
    for (const { file, path, source } of sources) {
      const pureContract =
        businessFeatures.has(path.split('/')[0]) &&
        (/\/application\/(?:ports|models|inputs)\//.test(path) || path.split('/')[1] === 'public');
      const pureShared =
        path.startsWith('common/application/') || path.startsWith('common/validation/');
      if (!pureContract && !pureShared) {
        continue;
      }
      for (const { specifier } of importsOf(source)) {
        const target = dependencyPath(file, specifier);
        if (
          (!target &&
            /^(?:@nestjs\/|typeorm|express|class-validator|class-transformer)/.test(specifier)) ||
          target?.includes('/presentation/') ||
          target?.includes('/infrastructure/') ||
          target?.startsWith('common/http/')
        ) {
          violations.push(`${path} -> ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not bypass production contracts with double type assertions', () => {
    const violations: string[] = [];
    for (const { path, source } of sources) {
      const visit = (node: ts.Node): void => {
        if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
          let inner = node.expression;
          while (ts.isParenthesizedExpression(inner)) {
            inner = inner.expression;
          }
          if (
            (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) &&
            inner.type.kind === ts.SyntaxKind.UnknownKeyword
          ) {
            violations.push(`${path}: ${node.getText(source)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('does not create cycles between features', () => {
    const dependencies = new Map<string, Set<string>>();
    for (const feature of featureNames) {
      dependencies.set(feature, new Set());
    }
    for (const { file, path, source } of sources) {
      const owner = path.split('/')[0];
      if (!featureNames.has(owner)) {
        continue;
      }
      for (const { specifier } of importsOf(source)) {
        const dependency = dependencyPath(file, specifier)?.split('/')[0];
        if (dependency && dependency !== owner && featureNames.has(dependency)) {
          dependencies.get(owner)?.add(dependency);
        }
      }
    }
    const cycles: string[] = [];
    const walk = (feature: string, stack: string[]): void => {
      if (stack.includes(feature)) {
        cycles.push([...stack, feature].join(' -> '));
        return;
      }
      for (const dependency of dependencies.get(feature) ?? []) {
        walk(dependency, [...stack, feature]);
      }
    };
    for (const feature of featureNames) {
      walk(feature, []);
    }
    expect(cycles).toEqual([]);
  });

  it('exports contracts instead of concrete application services from business modules', () => {
    const violations: string[] = [];
    for (const { file, path, source } of sources) {
      if (!businessFeatures.has(path.split('/')[0]) || !path.endsWith('.module.ts')) {
        continue;
      }
      const imports = new Map<string, string>();
      for (const statement of source.statements) {
        if (
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.importClause?.namedBindings &&
          ts.isNamedImports(statement.importClause.namedBindings)
        ) {
          const target = dependencyPath(file, statement.moduleSpecifier.text);
          for (const binding of statement.importClause.namedBindings.elements) {
            if (target) {
              imports.set(binding.name.text, target);
            }
          }
        }
      }
      const visit = (node: ts.Node): void => {
        if (
          ts.isDecorator(node) &&
          ts.isCallExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'Module'
        ) {
          const metadata = node.expression.arguments[0];
          if (metadata && ts.isObjectLiteralExpression(metadata)) {
            const exports = metadata.properties.find(
              (property): property is ts.PropertyAssignment =>
                ts.isPropertyAssignment(property) && property.name.getText(source) === 'exports',
            );
            if (exports && ts.isArrayLiteralExpression(exports.initializer)) {
              for (const exported of exports.initializer.elements) {
                const target = ts.isIdentifier(exported) ? imports.get(exported.text) : undefined;
                if (!target || !/^\w+\/(?:public|infrastructure\/public)\//.test(target)) {
                  violations.push(`${path}: ${exported.getText(source)}`);
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});
