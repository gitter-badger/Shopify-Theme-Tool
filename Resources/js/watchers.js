YUI().use('event-custom', function(Y) {
///////

var Watcher = YUI.namespace('Themer.Watcher');

Watcher.processes = [];

//Initialize all watchers on startup
Watcher.init = function(app) {

    app.shops.each(function(shop) {
        var themes = new Themer.themeList();
        themes.parent_id = shop.get('id');
        themes.load();

        themes.each(function(theme) {
            Watcher.start(shop, theme);
        });

    });
};

Watcher.kill = function(themeId) {
    Watcher.processes.forEach(function(o) {
        if(o.themeId == themeId) {
            Ti.API.warn('Killing '+ o.process.getPID());
            o.process.sendSignal(Ti.Process.SIGINT);
        }
    });
};

//Will find an open port to spin up server on
//Looks between 40000 - 50000 range
//If you know a better way to do this, please, let me know!
Watcher.start = function(shop, theme) {
    var port = random(40000, 50000);

    var portProc = Ti.Process.createProcess({
        args: ["lsof", "-i", ":"+port],
        env: {'PATH': '/usr/sbin:/usr/bin:/bin'}
    });

    portProc.setOnExit(function(e) {
        //code 0 == port not avail
        // code 1 == port available
        // console.log("Exit Code:" + e.getTarget().getExitCode());
        if(e.getTarget().getExitCode() == 1) {
            //Port avail, start
            console.log('Port Available. Starting Watcher...');
            Watcher.watch(shop, theme, port);
        }
        else {
            console.log("Exit Code:" + e.getTarget().getExitCode());
            Watcher.start(shop, theme);
        }
    });

    portProc.launch();

};

Watcher.watch = function(shop, theme, port) {
    console.log('Watch Theme: '+theme.get('id') + ' on port: '+port);
    var processPath = Ti.Filesystem.getFile(Ti.Filesystem.getResourcesDirectory(), 'lib', 'watch_server.rb');

    //Need to send in port as a string, else 'd' appended to it: ie: 40000 becomes 40000d
    var process = Ti.Process.createProcess({
        args: [processPath.nativePath(),theme.get('path'), port.toString()],
        env: {'PATH': '/usr/bin:/bin'}
    });

    // process.setOnReadLine(function(output) {
    //     console.log(output);
    // });

    process.launch();
    Watcher.processes.push({
        'themeId': theme.get('id'),
        'process':process
    });

    console.log('Watch process launched: '+ process.getPID());
    console.log('Watch process running: '+ process.isRunning());

    Y.Global.fire('watch:loading', {
        themeId: theme.get('id')
    });

    //Give server a second to spinup
    setTimeout(function() {
        Watcher.connect(shop, theme, port);
    }, 1000);

};

Watcher.connect = function(shop, theme, port, attempt) {
    console.log('Connecting socket theme: '+theme.get('id') +  ' on port '+ port);

    var maxAttempts = 10;

    attempt = attempt || 1;

    //port needs to be an int
    var socket = Ti.Network.createTCPSocket('127.0.0.1', parseInt(port, 10));

    socket.onError(function(e) {
        console.log('Error with socket');
        console.log(e);
        if(attempt <= maxAttempts) {
            console.log('Next try: '+ (1 * attempt)+'s');
            setTimeout(function() {
                Watcher.connect(shop, theme, port, (attempt+1));
            }, (1000 * attempt));
        } else {
            console.log('Too many attempts');
            Y.Global.fire('watch:stop', {
                themeId: theme.get('id')
            });

        }
    });
    socket.onTimeout(function(e) {
        console.log('Timeout with socket');
        // console.log(e);
    });

    socket.onRead(function(e) {
        // console.log('Read');
        var resp = e.toString();
        Ti.API.info(resp);
        //Bad data comes down socket for some reason from time to time
        if(resp.length <= 1) { return; }

        /**
         * resp for connect event:
         * { event: "connect" }
         * resp for create/update event:
         * { "base": "/Base/directory", "event":"create", "relative": "filename" }
         * @type {[type]}
         */
        resp = JSON.parse(resp);

        // Listen gem fires this off for its own testing purposes, so throw away
        if(resp.relative === ".listen_test") { return; }

        //update & create should have the same action.
        if((resp.event == 'update') || (resp.event == 'create')) {

            resp.theme = theme;
            resp.shop = shop;
            Y.Global.fire('asset:send', resp);
        }
        else if(resp.event == 'connect') {
            Y.Global.fire('watch:start', {
                themeId: theme.get('id')
            });
        }

    });

    socket.connect();

};

var killAllWatchers = function() {
    Ti.API.warn('Killing Watchers...');
    Watcher.processes.forEach(function(o) {
        Ti.API.warn('Killing '+ o.process.getPID());
        if(o.process.isRunning()) { o.process.sendSignal(Ti.Process.SIGINT); }
    });
};

//Clean up watchers on exit.
Y.Global.on('watch:killall', killAllWatchers);
Ti.API.addEventListener(Ti.APP_EXIT, killAllWatchers);

///////
});
