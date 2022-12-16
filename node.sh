sudo apt update
sudo apt upgrade -y
curl -sL https://deb.nodesource.com/setup_18.x -o /tmp/nodesource_setup.sh
sudo bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
sudo echo iptables-persistent iptables-persistent/autosave_v4 boolean true | sudo debconf-set-selections
sudo echo iptables-persistent iptables-persistent/autosave_v6 boolean true | sudo debconf-set-selections
sudo apt install -y iptables-persistent
