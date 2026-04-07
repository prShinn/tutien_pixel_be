package com.tutien.pixel.services;

import com.tutien.pixel.entities.playerEntity;
import com.tutien.pixel.repositories.PlayerRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class PlayerService {

    @Autowired
    private PlayerRepository repo;

    public List<playerEntity> all() {
        return repo.findAll();
    }

    public Optional<playerEntity> get(int id) {
        return repo.findById(id);
    }
    public Optional<playerEntity> getByUser(int id) {
        return repo.findByUserId(id);
    }

    public playerEntity create(playerEntity e) {
        return repo.save(e);
    }

    public playerEntity update(int id, playerEntity u) {
        playerEntity x = repo.findById(id).orElseThrow();
        // copy toàn bộ field
        x.setUserId(u.getUserId());
        x.setStats(u.getStats());
        x.setName(u.getName());
        x.setRoot(u.getRoot());
        x.setCanhGioi(u.getCanhGioi());
        x.setHp(u.getHp());
        x.setMaxHp(u.getMaxHp());
        x.setMp(u.getMp());
        x.setMaxMp(u.getMaxMp());
        x.setXu(u.getXu());
        x.setTuVi(u.getTuVi());
        x.setTuViLenCap(u.getTuViLenCap());
        x.setX(u.getX());
        x.setY(u.getY());
        x.setPx(u.getPx());
        x.setPy(u.getPy());
        x.setTrangBi(u.getTrangBi());
        x.setIventoryIndex(u.getIventoryIndex());
        x.setAttackCD(u.getAttackCD());
        x.setHeal_hp(u.getHeal_hp());
        x.setHeal_mp(u.getHeal_mp());
        x.setSttDaiCanhGioi(u.getSttDaiCanhGioi());
        x.setSttCanhGioi(u.getSttCanhGioi());
        x.setJsonIventory(u.getJsonIventory());
        return repo.save(x);
    }

    public void delete(int id) {
        repo.deleteById(id);
    }
}
