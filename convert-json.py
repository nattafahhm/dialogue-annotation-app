import json

with open("activity_types.json", "r") as read_file:
    data = json.load(read_file)
result = [json.dumps(record) for record in data]
with open('nd-proceesed.json', 'w') as obj:
    for i in result:
        obj.write(i+'\n')