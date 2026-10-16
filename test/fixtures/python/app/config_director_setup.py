from configdirector import create_client

client = create_client("YOUR-SERVER-SDK-KEY")

# Blocks until the client is initialized or it times out.
# If initialization times out, the client will continue attempting to
# initialize in the background.
client.initialize()
