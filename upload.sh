rm GoGameAlexaSkill.zip

cd src
zip -r ../GoGameAlexaSkill.zip ./* -q
chmod 755 ../GoGameAlexaSkill.zip
cd ..

echo "Running lambda update"
aws lambda update-function-code --function-name arn:aws:lambda:us-west-2:718706417401:function:GoGameAlexaSkill --zip-file fileb://./GoGameAlexaSkill.zip
