'use strict';

// Some hosts advertise an IPv6 route that doesn't actually work end-to-end
// (broken/blackholed VPN or router config). Node's default DNS ordering can
// still pick those addresses first, causing EHOSTUNREACH on sites that are
// perfectly reachable over IPv4. Force IPv4 first, process-wide, regardless
// of what the OS's own address sorting decides.
require('node:dns').setDefaultResultOrder('ipv4first');
