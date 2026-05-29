import { fileURLToPath } from 'node:url'

import { defineConfig } from 'eslint/config'
import { includeIgnoreFile } from '@eslint/compat'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url))

export default defineConfig(
	eslint.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	{
  	languageOptions: {
  		parserOptions: {
  			projectService: {
  				allowDefaultProject: [ 'eslint.config.mjs' ],
  			},
  		},
  	},
	  rules: {
	  	'array-bracket-spacing': [ 'error', 'always' ],
	  	'arrow-parens': [ 'error', 'as-needed' ],
	  	'comma-dangle': [ 'error', 'always-multiline' ],
	  	'indent': [ 'error', 'tab', { SwitchCase: 1 } ],
	  	'object-curly-spacing': [ 'error', 'always' ],
	  	'quotes': [ 'error', 'single' ],
	  	'semi': [ 'error', 'never' ],
	  	'space-before-function-paren': [ 'error', 'never' ],
	  	'sort-imports': [ 'error', { allowSeparatedGroups: true } ],
	  },
	},
	includeIgnoreFile(gitignorePath),
)
