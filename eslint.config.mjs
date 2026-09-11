// =============================================================
// ESLint (flat config) — Angular 22 + TypeScript.
//
// Reglas del repositorio que este fichero respeta:
//  · No se rebajan reglas para que una puerta pase: si algo falla, se arregla el código.
//  · No hay `ignore` masivos: `ignores` solo cubre artefactos generados (build, informes,
//    capturas) y `src/assets`, nunca fuente propia.
//  · La deuda previa del repositorio NO se silencia con `eslint-disable`: se mide con
//    `node scripts/lint-check.mjs`, que exige cero errores en los ficheros que YA estaban
//    limpios en HEAD (los nuevos y los tocados) y solo tolera los que ya venían sucios.
// =============================================================
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.angular/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'e2e/shots/**',
      'docs/screenshots/**',
      'src/assets/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // El proyecto usa `_` como prefijo de "no lo uso a propósito" (params de callbacks,
      // destructuración con descarte). No es una relajación: cualquier otro no-usado sigue
      // siendo error.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // El código de la app evita `any` explícito; en los tests de dobles (DataSource falso,
      // spies) tipar cada doble con precisión es ruido sin valor: se exige `unknown` o un
      // tipo real, nunca `any` silencioso.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {},
  },
);
