# Wplace Snapshot Maker

__Wplace Snapshot Maker__ - This is a local server on your PC that can take snapshots of the canvas site `wplace.live`. It works as a local site where communication takes place through a terminal, and the user is obliged to enter commands. This project is unfinished, so it needs time to introduce a user-friendly interface and additional features.

<img width="1918" height="937" alt="image" src="https://github.com/user-attachments/assets/a67e1bf9-aea7-4340-b648-fcf504a29120" />

## Other Languages
- [Ukranian](README.ua.md)
- [Russian](README.md)
May be outdated.

# Installation
You need to make sure you have an environment to execute `node.js` on your computer. If it is missing, you can download it here https://nodejs.org/en/download. It is recommended to copy the repository using the command: `git clone https://github.com/AFUtik/Wplace-Shapshot-Maker.git`
or download the repository archive and unpack it. After downloading the repository, run `start.bat` on Windows or `start.sh` if you have a Linux system. All necessary libraries will be installed in the root part of the project. After starting the server, open `localhost:3000` in your browser to go to the site. You can set your port in the `settings.json`.

# Usage
To use the main functions of the application, you will need to enter commands in the terminal that appears after launching the `start.bat` file. You can add different flags to each command, which will set the specific behavior of a particular function. All examples of how to use all the different commands will be described below. 

On the site you can select two markers with the right click, which will set the area of the picture. Run the `snapshot your_name -switch` command to create a snapshot and switch to it immediately. All ways to use this command are shown below.


```

# We can create 2 right markers with the right mouse button on the site, specifying a rectangular area, and write a flag -switch.
snapshot example0 -switch

# Creates a snapshot of the canvas called "example0" from point 1055 42 to point 1057 40.
snapshot example0 1055 42 1057 40

# After going to example0, we can re-execute the 'snapshot' command for example0 without arguments.
# that will create an updated snapshot of the canvas with pre-set points. You can also write the -switch/-s flag here.
snapshot

```
___
```
# Loads a snapshot called 'example1' (It requires to create a snapshot 'example1' with command 'snapshot'). Then it will appear on the map.
load example1

# This is a load of the 'example1' from 09/26/2025, if present.
load example1 09/26/2025

# With time
load example1 09/26/2025-15:45

```
___
```
# Show all created snapshots
show

# Show the whole history of a snapshot.
show example0
```
___
```
# Deletes the snapshot and its history.
delete example0
```
___ 
```
# Shows the memory usage on the disk of each snapshot.
memory

# Shows the memory usage of a particular snapshot.
memory example
```
