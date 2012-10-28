var fs = require('fs'),
    vm = require('vm'),
    _ = require('underscore'),
    path = require("path"),
    argv = require('optimist').argv,
    options = {
        basePath: argv.path || ".",
        stealCompatible: argv.steal_compatible == "true",
        backup: argv.backup !== "false",
        embedSteal: argv.embed_steal !== "false",
        cleanWhitespace: true
    };

function copyFunction(name, ret) {
    return function(){
        context.dependsQueue.push({type: "stealFn", fnStr: name  +"(" + _.map(arguments, function(a) { return JSON.stringify(a).replace(/"([^"'/\-\.:+*&]+)":/g, "$1:")}).join(",") +");"});
        return ret;
    };
}

var stealFunction = options.stealCompatible ? copyFunction : function() {};

var context = {
    console: console,
    idMap: {},
    pathMap: {},
    currentDepends: [],
    dependsTree: {},
    dependsQueue: [],
    copiedFunctions: [],
    resources: {},
    steal: buildTree,
    Resource: {
        make: makeResource
    }
};

context.window = context;

_.extend(context.steal, {
    packages: copyFunction("steal.packages", context.steal),
    has: stealFunction,
    pushPending: stealFunction,
    config: stealConfig,
    popPending: stealFunction,
    executed: storeTree,
    then: buildTree,
    global: addGlobal
});

function makeResource(resource) {
    if (resource.id.match(/\.js$/)) {
        context.resources[resource.id] = resource;
    }
    copyFunction("Resource.make").apply(this, arguments);
}

function buildTree() {
    context.currentDepends.push.apply(context.currentDepends, arguments);
    return context.steal;
}

function storeTree(id) {
    context.dependsTree[id] = context.currentDepends;
    context.dependsQueue.push(id);
    context.currentDepends = [];
}

function addGlobal(fn) {
    fn._global = true;
    context.currentDepends.push(fn);
}

function stealConfig(config) {
    _.each(config.map["*"], function(realId, idHolder) {
        context.idMap[idHolder] = realId;
    });
    _.extend(context.pathMap, config.paths);
}

(function() {

    function main() {
        context.sandbox = vm.createContext(context);
        var productionFile = path.join(options.basePath, "production.js");

        processFile(productionFile, context, true);
        _.each(context.resources, function(resource) {
            processResource(resource, context)
        });

        if (options.embedSteal) {
            var stealContents = fs.readFileSync(path.join(options.basePath, "../steal/steal.production.js")),
                prodContent = fs.readFileSync(productionFile);

            fs.writeFileSync(productionFile, stealContents);
            fs.appendFileSync(productionFile, "\n");
            fs.appendFileSync(productionFile, prodContent);
        }
    }

    function processResource(resource, context) {

        delete context.resources[resource.id];

        if (resource.needs) {
            for (var i = 0; i < resource.needs; ++i) {
                var needed = context.resources[resource.needs[i]];
                if (needed) {
                    processResource(needed, context)
                }
            }
        }

        processFile(path.join(options.basePath, "..", resource.id), context);
    }

    function processFile(file, context, includePreamble) {
        var match = file.match(/^(.*?)\.js$/),
            bak = match[1] + ".js.bak", source;


        if (options.backup) {
            source = fs.existsSync(bak) ? bak : file;
            if (source !== bak) {
                fs.renameSync(source, bak);
                console.log("moved " + source + " to " + bak);
                source = bak;
            }
        } else {
            source = file;
        }

        var data = fs.readFileSync(source),
            code = data
                .toString()
                .replace(/steal\.(executed|pushPending)\(([^\)]*)\);\s?(((?!steal).)[\s\S]*?)steal\.executed/g, "steal.$1($2);steal.global(function() {$3});steal.executed")
                .replace(/steal\.(executed|pushPending)\(([^\)]*)\);\s?(((?!steal).)[\s\S]*?)steal\.executed/g, "steal.$1($2);steal.global(function() {$3});steal.executed");

        if (options.cleanWhitespace) {
            code = code.replace(/\n\s+/g, "\n");
        }

        vm.runInContext(code, context.sandbox, file);
        var buffer = [];
        if (includePreamble) writePreamble(buffer);
        writeResources(context.dependsQueue, context.dependsTree, buffer);
        fs.writeFileSync(file, buffer.join(""));
        console.log(file + " finished, source: " + source);
    }

    function writePreamble(buffer) {
        var define = function (moduleId, dependencies, method) { _r[moduleId] = method(); };
        buffer.push("var _r = {};");
        buffer.push("window.define = " + define.toString() + ";");
        buffer.push("window.define.amd = { jQuery: true };")
    }

    function writeResources(dependsQueue, dependsTree, buffer, id, resourceId, file) {
        if (!dependsQueue) {
            if (id.match(/js$/)) console.log("Missing dependency id: " + id);
            return;
        }
        var dependency, lastIds = [];
        while (dependsQueue.length) {
            dependency = dependsQueue.shift();
            if (dependency.type == "stealFn") {
                buffer.push(dependency.fnStr)
            } else if (typeof dependency == "string") {
                var ids = getId(file, dependency, dependsTree);
                lastIds.push(ids.resourceId);
                writeResources(ids.resource, dependsTree, buffer, ids.id, ids.resourceId, ids.file);
            } else if (typeof dependency == "function") {
                writeFn(dependency, resourceId, lastIds, buffer);
            }
        }

        if (argv.steal_compatible && id && dependency) {
            buffer.push("steal.executed('" + id + "');");
            buffer.push("steal.resources['"+id+"'].value = _r." + attrEscape(resourceId) + ";");
        }
    }

    function writeFn(fn, id, resultIds, buffer) {
        var str = fn.toString();
        if (fn._global) {
            str = str.replace(/^function.*?\{/, "").replace(/}[^\}]*$/, "");
        } else {
            var results = [];
            for (var i = 0; i < Math.min(fn.length, resultIds.length); ++i) {
                results.push("_r."+attrEscape(resultIds[i]));
            }
            results = results.join(",");
            str = "_r."+attrEscape(id, true)+"=(" + str + ")("+ results +");";
        }

        buffer.push(str);
    }

    var minIdsStore = {};
    var minIds = 0;
    function attrEscape(id, minimise) {
        if (!minIdsStore[id]) {
            if (minimise) minIdsStore[id] = "_" + (++minIds);
            else return id.replace(/[/\-\.]/g, "_")
        }
        return minIdsStore[id]
    }


    /**
     *
     * @param parentFile the file path of the parent dependency
     * @param id the if that the parent dependency is requesting
     * @param dependsTree the dependency tree
     * @param result internal
     * @return {
     *  id: the raw file id with extension, not taking into account path remaps from config e.g. jquery/jquery.js
     *  file: the raw file id with extension, taking into account path remaps from config e.g. "can/util/jquery/jquery.1.8.1.js"
     *  resourceId: the id under which the resource is stored e.g. jquery
     *  resource: the actual resource
     * }
     */
    function getId(parentFile, id, dependsTree, result) {
        result = result || {};
        var resId = context.idMap[id] || id;
        if (dependsTree[resId]) {
            result.resource = dependsTree[resId];
            result.resourceId = resId;
        }
        if (context.pathMap[id]) result.file = context.pathMap[id];
        if (context.idMap[id] && !result.file) result.file = context.idMap[id];

        if (id[0] == ".") {
            id = path.join(path.extname(parentFile) ? path.dirname(parentFile) : parentFile, id);
            return getId(parentFile, id, dependsTree, result);
        }

        if (!path.extname(id)) {
            id = id + "/" + path.basename(id) + ".js";
            return getId(parentFile, id, dependsTree, result);
        }

        result.resourceId = result.resourceId || id;
        result.file = result.file || id;
        result.id = id;

        return result;
    }

    main();
})();


