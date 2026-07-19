import { URL, fileURLToPath } from 'node:url'

import { defineConfig } from 'eslint/config'
import eslint from '@eslint/js'
import { includeIgnoreFile } from 'eslint/config'
import tseslint from 'typescript-eslint'

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url))

export default defineConfig(
	{
		ignores: [ 'dist/' ],
	},
	eslint.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	{
		files: [ '**/*.ts' ],
  	languageOptions: {
  		parserOptions: {
  			projectService: true,
  		},
  	},
	  rules: {
	  	'array-bracket-spacing': [ 'error', 'always' ],
	  	'arrow-parens': [ 'error', 'as-needed' ],
	  	'comma-dangle': [ 'error', 'always-multiline' ],
	  	'indent': [ 'error', 'tab', { SwitchCase: 1 } ],
	  	'object-curly-spacing': [ 'error', 'always' ],
	  	'quotes': [ 'error', 'single', { avoidEscape: true } ],
	  	'semi': [ 'error', 'never' ],
	  	'space-before-function-paren': [ 'error', 'never' ],
	  	'sort-imports': [ 'error', { allowSeparatedGroups: true } ],
	  },
	},
  {
	  files: [ 'static/create-issue.js', 'eslint.config.mjs' ],
	  extends: [ tseslint.configs.disableTypeChecked ],
	  languageOptions: {
	    parser: eslint.parser,
	    parserOptions: {
	      projectService: false,
	    }
	  }
	},
  {
	  files: [ 'static/create-issue.js' ],
	  languageOptions: {
	  	globals: {
	  		document: "readonly",
	  		window: "readonly",
	  	}
	  }
	},
	includeIgnoreFile(gitignorePath),
)
