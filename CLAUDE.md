# Project: setalight

## Overview

This is a webapp for arranging a setlist of worship songs for church, showing the lyrics and chords for them.



Its key features:
 - hide or show chords separately on each stanza
 - hide or show each stanza separately
 - transpose key
 - one touch control (left/right -> change song, up/down -> scroll current song
 - songs can be reordered
 - smart layout/zoom to maximise the text size.
 - once loaded, doesn't require internet


Extra features I would like to add
 - quick way to add notes (e.g. "repeat this 4 times", "drop out here", etc)
 - quick edit feature for quick song corrections


The songs are input as chordpro files

## Core model: setlist

A setlist has the following properties
 - a date
 - a list of songs in an order, which are chordpro files

## UI
 - home page lists the songs in order
 - if you swipe left or right you switch songs
 - if you swipe

## Tech Stack
- we are using an offline first approach, with proper url navigation and page reload, handled by a service worker
 - we are using newer css techniques to do the transition to avoid FOUS and other things.

## Development Standards
- Do not use npm at all.
- Only use vanilla js. There should be no build step at all, ever.
- Only use js libraries that can be hosted locally within the project and loaded as modules
- Use modern HTML/CSS/JS. Do not care about old browser support
