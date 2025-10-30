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

We will use an edit mode paradigm. That is, in normal or "live" mode, then
theres now way to make destructive changes. e.g. delete songs, or change keys.
To do that, you have to enter edit mode explicitly. This has several goals

 - prevent mistakes in a live performance setting that could be disasterous
 - common UI pattern for the app
 - edit mode UI can be more complex/cluttered, and the normal mode is simple and minimal, to maximise information.

## Tech Stack
- we are using an offline first approach, with proper url navigation and page reload, handled by a service worker
- we are using newer css techniques to do the transition to avoid FOUS and other things.
- we are using lit for components


## Development Standards
- Do not use npm at all.
- Only use vanilla js. There should be no build step at all, ever.
- Only use js libraries that can be hosted locally within the project and loaded as modules
- Use modern HTML/CSS/JS. Do not care about old browser support
- Always try to use browser native features as much as possible
