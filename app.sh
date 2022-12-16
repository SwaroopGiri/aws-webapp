cd ~
mkdir webapp
mv README.md ami.pkr.hcl app.sh app.js mysql.sh node.sh cloudwatch.sh cloudwatch-config.json package-lock.json package.json test.js webapp.service ~/webapp/
cd webapp
npm ci
sudo mv webapp.service /etc/systemd/system
sudo systemctl daemon-reload
sudo systemctl start webapp.service
sudo systemctl enable webapp.service
