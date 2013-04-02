Steal Monkey
============

A Steal production.js optimizer.

Steal simply minimises and concatonates your JavaScript files into production.js, 
then executes Steal again at production run time to ensure dependencies are loaded
in the correct order. We found that in our large project of 50+ JavaScript files
the steal dependency tracking was adding ~200ms to the production page load time.

Steal Monkey removes the steal dependency loading from production.js (and packages) by
ordering the javascript dependencies at build time, instead of runtime. It does this by
executing the production.js in Node.js with a dummy version of Steal that builds a dependecy
tree, then flattens the dependency tree back into production.js.

* Orders loadind of JavaScript dependencies in production.js
* Optionally pre-appends steal.production.js to production.js to remove the extra request
* Supports Packages

Work in Progress
================

This is a work in progress into the Stealjs project stabilises into the next release.
