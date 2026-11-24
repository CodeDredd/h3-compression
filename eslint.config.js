import antfu from '@antfu/eslint-config'

export default antfu({}, {
  rules: {
    // The JSDoc in this repo documents the return type (`@returns { boolean }`)
    // and describes the value in the summary above it.
    'jsdoc/require-returns-description': 'off',
  },
})
