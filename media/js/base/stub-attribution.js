/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Create namespace
if (typeof Mozilla === 'undefined') {
    var Mozilla = {};
}

(function() {
    'use strict';

    /**
     * Constructs attribution data based on utm parameters and referrer information
     * for relay to the Firefox stub installer. Data is first signed and encoded via
     * an XHR request to the `stub_attribution_code` service, before being appended
     * to Bouncer download URLs as query parameters. Data returned from the service
     * is also stored in a session cookie to save multiple requests when navigating
     * pages. Bug https://bugzilla.mozilla.org/show_bug.cgi?id=1279291
     */
    var StubAttribution = {};

    StubAttribution.COOKIE_CODE_ID = 'moz-stub-attribution-code';
    StubAttribution.COOKIE_SIGNATURE_ID = 'moz-stub-attribution-sig';

    /**
     * Determines if session falls within the predefined stub attribution sample rate.
     * @return {Boolean}.
     */
    StubAttribution.withinAttributionRate = function() {
        return (Math.random() < StubAttribution.getAttributionRate()) ? true : false;
    };

    /**
     * Returns stub attribution value used for rate limiting.
     * @return {Number} float between 0 and 1.
     */
    StubAttribution.getAttributionRate = function() {
        var rate = $('html').attr('data-stub-attribution-rate');
        return isNaN(rate) ? 0 : Math.min(Math.max(parseFloat(rate), 0), 1);
    };

    /**
     * Returns true if both session cookies exist.
     * @return {Boolean} data.
     */
    StubAttribution.hasSessionCookie = function() {
        return Mozilla.Cookies.hasItem(StubAttribution.COOKIE_CODE_ID) && Mozilla.Cookies.hasItem(StubAttribution.COOKIE_SIGNATURE_ID);
    };

    /**
     * Stores a session cookie with stub attribution data values.
     * @param {Object} data - attribution_code, attribution_sig.
     */
    StubAttribution.setSessionCookie = function(data) {

        if (!data.attribution_code || !data.attribution_sig) {
            return;
        }

        Mozilla.Cookies.setItem(StubAttribution.COOKIE_CODE_ID, data.attribution_code, null, '/');
        Mozilla.Cookies.setItem(StubAttribution.COOKIE_SIGNATURE_ID, data.attribution_sig, null, '/');
    };

    /**
     * Gets stub attribution data from session cookie.
     * @return {Object} - attribution_code, attribution_sig.
     */
    StubAttribution.getSessionCookie = function() {
        return {
            /* eslint-disable camelcase */
            attribution_code: Mozilla.Cookies.getItem(StubAttribution.COOKIE_CODE_ID),
            attribution_sig: Mozilla.Cookies.getItem(StubAttribution.COOKIE_SIGNATURE_ID)
            /* eslint-enable camelcase */
        };
    };

    /**
     * Updates all download links on the page with additional query params for
     * stub attribution.
     * @param {Object} data - attribution_code, attribution_sig.
     */
    StubAttribution.updateBouncerLinks = function(data) {
        /**
         * If data is missing or the browser does not meet requirements for
         * stub attribution, then do nothing.
         */
        if (!data.attribution_code || !data.attribution_sig || !StubAttribution.meetsRequirements()) {
            return;
        }

        $('.download-link[href*="https://download.mozilla.org/"]').each(function() {
            var version = $(this).data('downloadVersion');
            // currently only Windows 32bit uses stub installer, but this could change
            // in the future so we'll make that bet now.
            if (version && (version === 'win' || version === 'win64')) {
                this.href = Mozilla.StubAttribution.appendToDownloadURL(this.href, data);
            }
        });
    };

    /**
     * Appends stub attribution data as URL parameters.
     * Note: data is already URI encoded when returned via the service.
     * @param {String url - URL to append data to.
     * @param {Object} data - attribution_code, attribution_sig.
     * @return {String} url + additional parameters.
     */
    StubAttribution.appendToDownloadURL = function(url, data) {

        if (!data.attribution_code || !data.attribution_sig) {
            return url;
        }

        // append stub attribution query params.
        $.each(data, function(key, val) {
            if (key === 'attribution_code' || key === 'attribution_sig') {
                url += (url.indexOf('?') > -1 ? '&' : '?') + key + '=' + val;
            }
        });

        return url;
    };

    /**
     * Handles XHR request from `stub_attribution_code` service.
     * @param {Object} data - attribution_code, attribution_sig.
     */
    StubAttribution.onRequestSuccess = function(data) {
        if (data.attribution_code && data.attribution_sig) {
            // Update download links on the current page.
            StubAttribution.updateBouncerLinks(data);
            // Store attribution data in a session cookie should the user navigate.
            StubAttribution.setSessionCookie(data);
        }
    };

    /**
     * AJAX request to bedrock service to authenticate stub attribution request.
     * @param {Object} data - utm params and referrer.
     */
    StubAttribution.requestAuthentication = function(data) {
        var SERVICE_URL = window.location.protocol + '//' + window.location.host + '/en-US/firefox/stub_attribution_code/';
        $.get(SERVICE_URL, data).done(StubAttribution.onRequestSuccess);
    };

    /**
     * Gets utm parameters and referrer information from the web page if they exist.
     * @param {String} ref - Optional referrer to facilitate testing.
     * @return {Object} - Stub attribution data object.
     */
    StubAttribution.getAttributionData = function(ref) {
        var params = new window._SearchParams().utmParams();
        var referrer = typeof ref !== 'undefined' ? ref : document.referrer;
        var utmCount = 0;

        for (var utm in params) {
            if (params.hasOwnProperty(utm)) {
                utmCount += 1;
            }
        }

        // if there are no utm params and no referrer, do nothing.
        if (utmCount === 0 && (typeof referrer === 'undefined' || referrer === '')) {
            return false;
        }

        /* eslint-disable camelcase */
        return {
            utm_source: params.utm_source,
            utm_medium: params.utm_medium,
            utm_campaign: params.utm_campaign,
            utm_content: params.utm_content,
            referrer: referrer
        };
        /* eslint-enable camelcase */
    };

    /**
     * Determine if the current page is scene2 of /firefox/new/.
     * This is needed as scene2 auto-initiates the download. There is little point
     * trying to make an XHR request here before the download begins, and we don't
     * want to make the request a dependency on the download starting.
     * @return {Boolean}.
     */
    StubAttribution.isFirefoxNewScene2 = function(location) {
        location = typeof location !== 'undefined' ? location : window.location.href;
        return location.indexOf('/firefox/new/?scene=2') > -1;
    };

    /**
     * Determines if requirements for stub attribution to work are satisfied.
     * Stub attribution is only applicable to Windows users who get the stub installer.
     * @return {Boolean}.
     */
    StubAttribution.meetsRequirements = function() {

        if (window.site.platform !== 'windows') {
            return false;
        }

        if (window.site.needsSha1()) {
            return false;
        }

        if (window._dntEnabled()) {
            return false;
        }

        return true;
    };

    /**
     * Determines whether to make a request to the stub authentication service.
     */
    StubAttribution.init = function() {
        var data = {};

        if (!StubAttribution.meetsRequirements()) {
            return;
        }

        /**
         * If session cookie already exists, update download links on the page,
         * else make a request to the service if within attribution rate.
         */
        if (StubAttribution.hasSessionCookie()) {

            data = StubAttribution.getSessionCookie();
            StubAttribution.updateBouncerLinks(data);

        // As long as the user is not already on scene2 of the main download page,
        // make the XHR request to the stub authentication service.
        } else if (!StubAttribution.isFirefoxNewScene2()) {

            data = StubAttribution.getAttributionData();

            if (data && StubAttribution.withinAttributionRate()) {
                StubAttribution.requestAuthentication(data);
            }
        }
    };

    window.Mozilla.StubAttribution = StubAttribution;
})();